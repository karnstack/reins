import {
  ListGroupsResult,
  ListTabsResult,
  type ResponseMeta,
  type Tab,
  type TabGroup,
} from "@reins/protocol";
import { z } from "zod";
import { type AuditHook, redactParams } from "./audit.js";
import type { BridgePort, BridgeReply } from "./bridge.js";

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

/** List tab groups across connected browsers, tagged like listAllTabs. A
 *  browser without tab groups (Arc, Dia) or with an older extension adds
 *  nothing; only when every targeted browser fails does the error surface. */
export async function listAllGroups(bridge: BridgePort, browserId?: string): Promise<TabGroup[]> {
  const settled = await Promise.allSettled(
    targetBrowsers(bridge, browserId).map(async (b) => {
      const raw = await bridge.request("list_groups", {}, { browserId: b.id });
      const { groups } = ListGroupsResult.parse(raw);
      return groups.map((g) => ({ ...g, browserId: b.id, browser: b.browser }));
    }),
  );
  const ok = settled.filter((s) => s.status === "fulfilled");
  const failed = settled.find((s) => s.status === "rejected");
  if (ok.length === 0 && failed) throw failed.reason;
  return ok.flatMap((s) => s.value);
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
        ms: Date.now() - started,
      });
    } catch {
      // An audit hook must never affect the RPC result: a throw here on the
      // success path would land in handleRpc's catch — double-recording the
      // attempt and rejecting a genuinely successful call.
    }
  };

  try {
    if (method === "list_tabs") {
      const tabs = await listAllTabs(bridge, browserId);
      finish({ ok: true, browserId });
      return { tabs };
    }
    if (method === "list_groups") {
      const groups = await listAllGroups(bridge, browserId);
      finish({ ok: true, browserId });
      return { groups };
    }
    const reply: BridgeReply = await bridge.requestFull(method, params, { browserId });
    finish({ ok: true, browserId: reply.browserId, meta: reply.meta });
    return reply.result;
  } catch (err) {
    const e = (err instanceof Error ? err : new Error(String(err))) as Error & {
      code?: string;
      meta?: ResponseMeta;
      browserId?: string;
    };
    finish({ ok: false, browserId: e.browserId ?? browserId, meta: e.meta, error: e });
    throw err;
  }
}
