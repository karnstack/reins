import {
  hostOf,
  type JevActParams,
  JevActResult,
  JevObservation,
  type ResponseMeta,
} from "@reins/protocol";
import { z } from "zod";
import { type AuditHook, redactParams } from "../audit.js";
import type { BridgePort } from "../bridge.js";
import { RpcBadRequest } from "../rpc.js";
import { createJevAsk, type JevAsk } from "./client.js";
import { readKey } from "./credentials.js";
import { nextCommand } from "./format.js";
import { runLoop } from "./loop.js";
import { newRun, RunStore } from "./runs.js";
import type { DoResult, RunState } from "./types.js";

export const DoParams = z.object({
  browserId: z.string().optional(),
  tabId: z.number().optional(),
  goal: z.string().trim().min(1).optional(),
  fills: z.record(z.string().regex(/^[a-z0-9_-]+$/), z.string()).default({}),
  confirms: z.array(z.string()).default([]),
  continue: z.boolean().default(false),
  maxSteps: z.number().int().min(1).max(200).default(30),
  timeoutSec: z.number().int().min(5).max(600).default(60),
});
export type DoParams = z.infer<typeof DoParams>;

export interface DoContext {
  runs: RunStore;
  /** Where credentials.json lives; the key is read here, never passed around. */
  credentialsDir: string;
  /** Aborted when the CLI hangs up or the daemon shuts down. */
  signal: AbortSignal;
  audit?: AuditHook;
  /** Test seam: replaces the TypeSafe client; `onUsage` reports each call's input tokens. */
  createAsk?: (key: string, onUsage: (inputTokens: number) => void) => JevAsk;
  now?: () => number;
}

/** An extension from before PR2 answers jev_* with "unknown method". */
const TOO_OLD = /unknown method: jev_/;

function abortReason(signal: AbortSignal): string {
  const r = signal.reason as unknown;
  return r instanceof Error ? r.message : typeof r === "string" ? r : "stopped";
}

type BridgeError = Error & { code?: string; meta?: ResponseMeta; browserId?: string };

/**
 * One `reins do` invocation, daemon-side: key check → first observation
 * (which also settles the tab) → run memory (--continue) → the loop →
 * the result with its next command. Never throws, except `RpcBadRequest`
 * for malformed params (a 400); every other failure is a `DoResult` with
 * status `error`, so the CLI always has something to print.
 */
export async function handleDo(
  bridge: BridgePort,
  raw: unknown,
  ctx: DoContext,
): Promise<DoResult> {
  const parsed = DoParams.safeParse(raw ?? {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    // A record key (a fill name) is part of the path; it is user input, so
    // anything that isn't a plain name is quoted to keep the error one line.
    const path =
      issue?.path
        .map((seg) =>
          typeof seg === "number" || (typeof seg === "string" && /^[\w-]+$/.test(seg))
            ? seg
            : JSON.stringify(String(seg)),
        )
        .join(".") || "params";
    throw new RpcBadRequest(`invalid reins do params: ${path}: ${issue?.message ?? "invalid"}`);
  }
  const p = parsed.data;
  const now = ctx.now ?? Date.now;
  const started = now();
  const stop = (status: "error" | "interrupted", reason: string): DoResult => ({
    status,
    reason,
    steps: [],
    url: "",
    title: "",
    elapsedMs: now() - started,
    jevCalls: 0,
    inputTokens: 0,
    step: 0,
    maxSteps: p.maxSteps,
    pageChanges: 0,
  });
  const fail = (reason: string): DoResult => stop("error", reason);

  let key: string | undefined;
  try {
    key = readKey(ctx.credentialsDir);
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
  if (!key) {
    return fail(
      "no TypeSafe key — run `reins key set typesafe`, or add one in the extension popup",
    );
  }
  // A missing goal needs no tab: fail before the first observation.
  if (!p.continue && !p.goal) return fail('a goal is required: reins do "<goal>"');
  // A shutdown or hang-up that lands before the first observation: no action
  // was taken, so say so without touching the browser.
  if (ctx.signal.aborted) return stop("interrupted", abortReason(ctx.signal));

  // The first observation resolves the browser and tab; they are pinned
  // once, so a later reply can't drift the run to another tab.
  let browserId = p.browserId;
  let tabId = p.tabId;
  const call = async (
    method: "jev_observe" | "jev_act",
    params: Record<string, unknown>,
  ): Promise<unknown> => {
    const t0 = now();
    const payload = { ...params, ...(tabId !== undefined ? { tabId } : {}) };
    try {
      const reply = await bridge.requestFull(method, payload, browserId ? { browserId } : {});
      browserId ??= reply.browserId;
      tabId ??= reply.meta?.tabId;
      if (method === "jev_act") {
        audit(ctx, {
          method,
          browserId,
          meta: reply.meta,
          params: payload,
          ok: true,
          ms: now() - t0,
        });
      }
      return reply.result;
    } catch (err) {
      const e = (err instanceof Error ? err : new Error(String(err))) as BridgeError;
      if (method === "jev_act") {
        audit(ctx, {
          method,
          browserId: e.browserId ?? browserId,
          meta: e.meta,
          params: payload,
          ok: false,
          ms: now() - t0,
          error: e,
        });
      }
      if (TOO_OLD.test(e.message)) {
        throw new Error(
          "the reins extension is too old for reins do — update it (reins extension --reload for unpacked builds)",
        );
      }
      throw e;
    }
  };

  let first: JevObservation;
  try {
    first = JevObservation.parse(await call("jev_observe", {}));
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
  if (browserId === undefined || tabId === undefined)
    return fail("couldn't tell which tab to drive");
  const firstTab = tabId;
  let runKey = RunStore.key(browserId, tabId);
  if (!ctx.runs.tryBegin(runKey)) {
    // After Ctrl-C the lock stays held until the in-flight jev_act returns.
    return fail(
      "a reins do run is already active on this tab (if you just stopped one, it is finishing its last action; retry in a moment)",
    );
  }
  try {
    let run: RunState;
    if (p.continue) {
      const prev = ctx.runs.get(runKey);
      if (!prev) {
        return fail(
          `no run to continue on this tab (runs are forgotten after 15 minutes or a daemon restart) — run reins do "<goal>" again`,
        );
      }
      run = {
        ...prev,
        ...(p.goal ? { goal: p.goal } : {}),
        fills: { ...prev.fills, ...p.fills },
        confirms: [...prev.confirms, ...p.confirms],
      };
    } else {
      run = newRun(p.goal as string, hostOf(first.url), p.fills, p.confirms, now());
    }
    let inputTokens = 0;
    const onUsage = (n: number) => {
      inputTokens += n;
    };
    const ask = (ctx.createAsk ?? ((k: string) => createJevAsk({ key: k, onUsage })))(key, onUsage);
    // One signal for the loop: the hang-up/shutdown signal, plus --timeout.
    // A Jev call or jev_act in flight when the budget runs out is cut short,
    // so the run always answers inside the CLI's HTTP wait.
    const timeoutMs = p.timeoutSec * 1000;
    const loopCtrl = new AbortController();
    const onAbort = () => loopCtrl.abort(ctx.signal.reason);
    ctx.signal.addEventListener("abort", onAbort, { once: true });
    // A hang-up that landed during the first observation fired before the
    // listener existed: carry it over, or the loop would run to its timeout.
    if (ctx.signal.aborted) loopCtrl.abort(ctx.signal.reason);
    const timer = setTimeout(
      () => loopCtrl.abort(new DOMException(`timed out after ${p.timeoutSec}s`, "TimeoutError")),
      timeoutMs,
    );
    let after: RunState;
    let result: DoResult;
    try {
      ({ result, run: after } = await runLoop(
        {
          observe: async () => JevObservation.parse(await call("jev_observe", {})),
          act: async (a: Omit<JevActParams, "browserId" | "tabId">) =>
            JevActResult.parse(await call("jev_act", a)),
          ask,
          now,
          inputTokens: () => inputTokens,
          // A link opened a new tab: the run follows it (the extension has
          // brought it forward), and its memory moves with it.
          retarget: (id: number) => {
            const moved = RunStore.key(browserId as string, id);
            // A brand-new tab can't be busy; if it somehow is, keep our own
            // key so the finally below never releases someone else's lock.
            if (!ctx.runs.tryBegin(moved)) {
              throw new Error(`a reins do run is already active on tab ${id}`);
            }
            tabId = id;
            ctx.runs.delete(runKey);
            ctx.runs.end(runKey);
            runKey = moved;
          },
        },
        {
          run,
          maxSteps: p.maxSteps,
          timeoutMs,
          signal: loopCtrl.signal,
          continued: p.continue,
          first,
        },
      ));
    } finally {
      clearTimeout(timer);
      ctx.signal.removeEventListener("abort", onAbort);
    }
    ctx.runs.set(runKey, after);
    // The next command routes the way the user did: only an explicit
    // --tab/--browser is echoed back, so a default-tab run stays short —
    // unless the run moved to a new tab, which every next line must name.
    const moved = tabId !== firstTab;
    const next = nextCommand(result, {
      goal: after.goal,
      ...(p.tabId !== undefined || moved ? { tabId } : {}),
      ...(p.browserId !== undefined ? { browserId: p.browserId } : {}),
    });
    return { ...result, tabId, ...(next !== undefined ? { next } : {}) };
  } finally {
    ctx.runs.end(runKey);
  }
}

/** One jev_act audit line, shaped like the bridge's own records (rpc.ts). */
function audit(
  ctx: DoContext,
  o: {
    method: string;
    browserId: string | undefined;
    meta: ResponseMeta | undefined;
    params: Record<string, unknown>;
    ok: boolean;
    ms: number;
    error?: BridgeError;
  },
): void {
  if (!ctx.audit) return;
  try {
    const { tabId, label, ...rest } = o.params;
    // A select's label is "Field → chosen option"; the option is a value the
    // page typed for the user, so the audit keeps only the field.
    const shown = typeof label === "string" ? { label: label.split(" → ")[0] ?? label } : {};
    ctx.audit({
      ts: new Date(Date.now() - o.ms).toISOString(),
      method: o.method,
      ...(o.browserId !== undefined ? { browserId: o.browserId } : {}),
      ...(o.meta?.tabId !== undefined
        ? { tabId: o.meta.tabId }
        : typeof tabId === "number"
          ? { tabId }
          : {}),
      ...(o.meta?.host !== undefined ? { host: o.meta.host } : {}),
      ...(o.meta?.tier !== undefined ? { tier: o.meta.tier } : {}),
      params: { ...redactParams(o.method, rest), ...shown },
      ok: o.ok,
      ...(o.error?.code === "policy_denied" ? { denied: true } : {}),
      ...(o.error ? { error: o.error.message } : {}),
      ms: o.ms,
    });
  } catch {
    // auditing never affects the run
  }
}
