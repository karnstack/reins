import {
  ListGroupsResult,
  ListTabsResult,
  type ResponseMeta,
  type SkippedBrowser,
  type Tab,
  type TabGroup,
} from "@reins/protocol";
import { z } from "zod";
import { type AuditHook, redactParams } from "./audit.js";
import type { BridgePort, BridgeReply } from "./bridge.js";
import { KEY_METHODS, type KeyService } from "./jev/keys.js";
import type { DoResult } from "./jev/types.js";

/** Daemon-side services and the per-request abort signal. */
export interface RpcContext {
  keys?: KeyService;
  /** Aborted when the CLI hangs up or the daemon shuts down. */
  signal?: AbortSignal;
  /** `reins do`, run in the daemon (serve.ts wires handleDo). */
  doRun?: (params: Record<string, unknown>, signal: AbortSignal) => Promise<DoResult>;
}

const RpcBody = z.object({
  method: z.string().min(1),
  params: z.record(z.string(), z.unknown()).optional(),
});

/** The browsers a fan-out call targets: all, or the one named. */
function targetBrowsers(bridge: BridgePort, browserId?: string): BridgePort["browsers"] {
  const targets = browserId ? bridge.browsers.filter((b) => b.id === browserId) : bridge.browsers;
  if (browserId !== undefined && targets.length === 0) {
    const roster = bridge.browsers.map((b) => `${b.id} (${b.browser})`).join(", ");
    throw new Error(`unknown browserId "${browserId}"${roster ? `. Connected: ${roster}` : ""}`);
  }
  return targets;
}

/** List tabs across connected browsers (all, or one), tagging each tab with
 *  its browserId + browser name. */
export async function listAllTabs(bridge: BridgePort, browserId?: string): Promise<Tab[]> {
  const results = await Promise.all(
    targetBrowsers(bridge, browserId).map(async (b) => {
      const raw = await bridge.request("list_tabs", {}, { browserId: b.id });
      const { tabs } = ListTabsResult.parse(raw);
      return tabs.map((t) => ({ ...t, browserId: b.id, browser: b.browser }));
    }),
  );
  return results.flat();
}

const GROUP_METHODS = new Set(["list_groups", "group_tabs", "update_group", "ungroup_tabs"]);
const UNKNOWN_GROUP_METHOD = /unknown method: (list_groups|group_tabs|update_group|ungroup_tabs)\b/;

type BridgeError = Error & { code?: string; meta?: ResponseMeta; browserId?: string };

/** Why a tab-group call failed, when the cause is the browser itself. */
function classifyGroupError(err: BridgeError): "unsupported" | "outdated" | undefined {
  if (err.code === "unsupported") return "unsupported";
  if (UNKNOWN_GROUP_METHOD.test(err.message)) return "outdated";
  return undefined;
}

/**
 * Rewrite a failed tab-group call into a message naming the browser: the
 * extension only knows "this browser", but the user may have several
 * connected. Only `unsupported` (no chrome.tabGroups API) and an older
 * extension's "unknown method" are rewritten; anything else is returned
 * as-is. The rewritten error keeps `code`, `meta`, and `browserId`.
 */
export function describeGroupError(
  bridge: BridgePort,
  err: BridgeError,
  browserId: string | undefined = err.browserId,
): { error: BridgeError; reason: "unsupported" | "outdated" | undefined } {
  const reason = classifyGroupError(err);
  if (reason === undefined) return { error: err, reason };
  const name = browserId ? bridge.browsers.find((b) => b.id === browserId)?.browser : undefined;
  const who = name && browserId ? `${name} (${browserId})` : "this browser";
  const message =
    reason === "unsupported"
      ? `${who} doesn't support tab groups — reins groups/group/ungroup need the chrome.tabGroups API, which this browser doesn't provide. Other reins commands work normally.`
      : `${who}'s reins extension predates tab groups — update it (Chrome Web Store), or run \`reins extension --reload\` for an unpacked build.`;
  const error = new Error(message) as BridgeError;
  if (err.code !== undefined) error.code = err.code;
  if (err.meta !== undefined) error.meta = err.meta;
  if (err.browserId !== undefined) error.browserId = err.browserId;
  return { error, reason };
}

/** List tab groups across connected browsers, tagged like listAllTabs. A
 *  browser that can't answer — no tab-group API, an older extension,
 *  or a plain failure — is reported in `skipped` with a message naming it.
 *  Only when every targeted browser fails does the (rewritten) error throw. */
export async function listAllGroups(
  bridge: BridgePort,
  browserId?: string,
): Promise<{ groups: TabGroup[]; skipped: SkippedBrowser[] }> {
  const targets = targetBrowsers(bridge, browserId);
  const settled = await Promise.allSettled(
    targets.map(async (b) => {
      const raw = await bridge.request("list_groups", {}, { browserId: b.id });
      const { groups } = ListGroupsResult.parse(raw);
      return groups.map((g) => ({ ...g, browserId: b.id, browser: b.browser }));
    }),
  );
  const groups: TabGroup[] = [];
  const skipped: SkippedBrowser[] = [];
  let firstFailure: BridgeError | undefined;
  settled.forEach((s, i) => {
    const b = targets[i];
    if (!b) return;
    if (s.status === "fulfilled") {
      groups.push(...s.value);
      return;
    }
    const raw = (s.reason instanceof Error ? s.reason : new Error(String(s.reason))) as BridgeError;
    const { error, reason } = describeGroupError(bridge, raw, b.id);
    firstFailure ??= error;
    skipped.push({
      browserId: b.id,
      browser: b.browser,
      reason: reason ?? "error",
      message: error.message,
    });
  });
  // Every targeted browser failed (incl. the single --browser case): keep the
  // non-zero exit, but with the named message.
  if (firstFailure && skipped.length === targets.length) throw firstFailure;
  return { groups, skipped };
}

/** Split the client-facing params into routing (browserId) + browser payload. */
function route(raw: Record<string, unknown>): {
  browserId: string | undefined;
  params: Record<string, unknown>;
} {
  const { browserId, ...params } = raw;
  return { browserId: typeof browserId === "string" ? browserId : undefined, params };
}

/** Thrown for malformed request bodies (daemon replies 400 instead of 502). */
export class RpcBadRequest extends Error {}

/**
 * Execute one /rpc call: `{method, params}` → bridge → browser. `list_tabs`
 * aggregates across all connected browsers; everything else routes to one
 * browser. When `audit` is provided, every attempt — success, policy
 * denial, or daemon-side failure — produces exactly one record.
 */
export async function handleRpc(
  bridge: BridgePort,
  body: unknown,
  audit?: AuditHook,
  ctx: RpcContext = {},
): Promise<unknown> {
  const parsed = RpcBody.safeParse(body);
  if (!parsed.success) {
    throw new RpcBadRequest(`invalid rpc body: expected {method, params?}`);
  }
  const { method, params: raw } = parsed.data;
  const { browserId, params } = route(raw ?? {});
  const started = Date.now();

  const finish = (outcome: {
    ok: boolean;
    browserId?: string;
    meta?: ResponseMeta;
    error?: Error & { code?: string };
    outcome?: string;
  }): void => {
    if (!audit) return;
    try {
      const browser = outcome.browserId
        ? bridge.browsers.find((b) => b.id === outcome.browserId)?.browser
        : undefined;
      const tabId =
        outcome.meta?.tabId ?? (typeof params.tabId === "number" ? params.tabId : undefined);
      audit({
        ts: new Date(started).toISOString(),
        method,
        ...(outcome.browserId !== undefined ? { browserId: outcome.browserId } : {}),
        ...(browser !== undefined ? { browser } : {}),
        ...(tabId !== undefined ? { tabId } : {}),
        ...(outcome.meta?.host !== undefined ? { host: outcome.meta.host } : {}),
        ...(outcome.meta?.tier !== undefined ? { tier: outcome.meta.tier } : {}),
        params: redactParams(method, params),
        ok: outcome.ok,
        ...(outcome.error?.code === "policy_denied" ? { denied: true } : {}),
        ...(outcome.error !== undefined ? { error: outcome.error.message } : {}),
        ...(outcome.outcome !== undefined ? { outcome: outcome.outcome } : {}),
        ms: Date.now() - started,
      });
    } catch {
      // An audit hook must never affect the RPC result: a throw here on the
      // success path would land in handleRpc's catch — double-recording the
      // attempt and rejecting a genuinely successful call.
    }
  };

  try {
    if (KEY_METHODS.has(method)) {
      if (!ctx.keys) throw new Error(`${method} is not available in this daemon`);
      const status = await ctx.keys.handle(method, params);
      finish({ ok: true });
      return status;
    }
    if (method === "do") {
      if (!ctx.doRun) throw new Error("reins do is not available in this daemon");
      // The whole run is one audit line; each jev_act inside adds its own.
      const result = await ctx.doRun(raw ?? {}, ctx.signal ?? new AbortController().signal);
      finish({
        ok: result.status === "done",
        browserId,
        outcome: `${result.status} · ${result.step} steps · ${result.jevCalls} jev calls`,
        ...(result.status !== "done"
          ? { error: new Error(`${result.status}: ${result.reason ?? ""}`) }
          : {}),
      });
      return result;
    }
    if (method === "list_tabs") {
      const tabs = await listAllTabs(bridge, browserId);
      finish({ ok: true, browserId });
      return { tabs };
    }
    if (method === "list_groups") {
      const { groups, skipped } = await listAllGroups(bridge, browserId);
      finish({ ok: true, browserId });
      return { groups, skipped };
    }
    const reply: BridgeReply = await bridge.requestFull(method, params, { browserId });
    finish({ ok: true, browserId: reply.browserId, meta: reply.meta });
    return reply.result;
  } catch (err) {
    const raw = (err instanceof Error ? err : new Error(String(err))) as BridgeError;
    // Name the browser before auditing so the record carries the same
    // message the user sees. list_groups already did this per browser.
    const e =
      GROUP_METHODS.has(method) && method !== "list_groups"
        ? describeGroupError(bridge, raw, raw.browserId ?? browserId).error
        : raw;
    finish({ ok: false, browserId: e.browserId ?? browserId, meta: e.meta, error: e });
    throw e === raw ? err : e;
  }
}
