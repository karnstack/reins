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
  /** Test seam: replaces the TypeSafe client. */
  createAsk?: (key: string) => JevAsk;
  now?: () => number;
}

/** An extension from before PR2 answers jev_* with "unknown method". */
const TOO_OLD = /unknown method: jev_/;

type BridgeError = Error & { code?: string; meta?: ResponseMeta; browserId?: string };

/**
 * One `reins do` invocation, daemon-side: key check → first observation
 * (which also settles the tab) → run memory (--continue) → the loop →
 * the result with its next command. Never throws: every failure is a
 * `DoResult` with status `error`, so the CLI always has something to print.
 */
export async function handleDo(
  bridge: BridgePort,
  raw: unknown,
  ctx: DoContext,
): Promise<DoResult> {
  const p = DoParams.parse(raw ?? {});
  const now = ctx.now ?? Date.now;
  const started = now();
  const fail = (reason: string): DoResult => ({
    status: "error",
    reason,
    steps: [],
    url: "",
    title: "",
    elapsedMs: now() - started,
    jevCalls: 0,
    step: 0,
    maxSteps: p.maxSteps,
    pageChanges: 0,
  });

  const key = readKey(ctx.credentialsDir);
  if (!key) {
    return fail(
      "no TypeSafe key — run `reins key set typesafe`, or add one in the extension popup",
    );
  }

  // The first observation resolves the browser and tab; every later call
  // pins them so the run can't drift to another tab.
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
      browserId = reply.browserId;
      tabId = reply.meta?.tabId ?? tabId;
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
  const runKey = RunStore.key(browserId, tabId);
  if (!ctx.runs.tryBegin(runKey)) return fail("a reins do run is already active on this tab");
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
      if (!p.goal) return fail('a goal is required: reins do "<goal>"');
      run = newRun(p.goal, hostOf(first.url), p.fills, p.confirms, now());
    }
    const ask = (ctx.createAsk ?? ((k: string) => createJevAsk({ key: k })))(key);
    const { result, run: after } = await runLoop(
      {
        observe: async () => JevObservation.parse(await call("jev_observe", {})),
        act: async (a: Omit<JevActParams, "browserId" | "tabId">) =>
          JevActResult.parse(await call("jev_act", a)),
        ask,
        now,
      },
      {
        run,
        maxSteps: p.maxSteps,
        timeoutMs: p.timeoutSec * 1000,
        signal: ctx.signal,
        continued: p.continue,
        first,
      },
    );
    ctx.runs.set(runKey, after);
    // The next command routes the way the user did: only an explicit
    // --tab/--browser is echoed back, so a default-tab run stays short.
    const next = nextCommand(result, {
      goal: after.goal,
      ...(p.tabId !== undefined ? { tabId: p.tabId } : {}),
      ...(p.browserId !== undefined ? { browserId: p.browserId } : {}),
    });
    return { ...result, ...(next !== undefined ? { next } : {}) };
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
    const { tabId, ...rest } = o.params;
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
      params: redactParams(o.method, rest),
      ok: o.ok,
      ...(o.error?.code === "policy_denied" ? { denied: true } : {}),
      ...(o.error ? { error: o.error.message } : {}),
      ms: o.ms,
    });
  } catch {
    // auditing never affects the run
  }
}
