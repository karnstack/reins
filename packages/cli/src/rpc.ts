import { ListTabsResult, type ResponseMeta, type Tab } from "@reins/protocol";
import { z } from "zod";
import { type AuditHook, redactParams } from "./audit.js";
import type { BridgePort, BridgeReply } from "./bridge.js";

const RpcBody = z.object({
  method: z.string().min(1),
  params: z.record(z.string(), z.unknown()).optional(),
});

/** List tabs across connected browsers (all, or one), tagging each tab with
 *  its browserId + browser name. */
export async function listAllTabs(bridge: BridgePort, browserId?: string): Promise<Tab[]> {
  const targets = browserId ? bridge.browsers.filter((b) => b.id === browserId) : bridge.browsers;
  if (browserId !== undefined && targets.length === 0) {
    const roster = bridge.browsers.map((b) => `${b.id} (${b.browser})`).join(", ");
    throw new Error(`unknown browserId "${browserId}"${roster ? ` — connected: ${roster}` : ""}`);
  }
  const results = await Promise.all(
    targets.map(async (b) => {
      const raw = await bridge.request("list_tabs", {}, { browserId: b.id });
      const { tabs } = ListTabsResult.parse(raw);
      return tabs.map((t) => ({ ...t, browserId: b.id, browser: b.browser }));
    }),
  );
  return results.flat();
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
    const browser = outcome.browserId
      ? bridge.browsers.find((b) => b.id === outcome.browserId)?.browser
      : undefined;
    audit({
      ts: new Date(started).toISOString(),
      method,
      ...(outcome.browserId !== undefined ? { browserId: outcome.browserId } : {}),
      ...(browser !== undefined ? { browser } : {}),
      ...(outcome.meta?.tabId !== undefined ? { tabId: outcome.meta.tabId } : {}),
      ...(outcome.meta?.host !== undefined ? { host: outcome.meta.host } : {}),
      ...(outcome.meta?.tier !== undefined ? { tier: outcome.meta.tier } : {}),
      params: redactParams(method, params),
      ok: outcome.ok,
      ...(outcome.error?.code === "policy_denied" ? { denied: true } : {}),
      ...(outcome.error !== undefined ? { error: outcome.error.message } : {}),
      ms: Date.now() - started,
    });
  };

  try {
    if (method === "list_tabs") {
      const tabs = await listAllTabs(bridge, browserId);
      finish({ ok: true, browserId });
      return { tabs };
    }
    const reply: BridgeReply = await bridge.requestFull(method, params, { browserId });
    finish({ ok: true, browserId: reply.browserId, meta: reply.meta });
    return reply.result;
  } catch (err) {
    const e = (err instanceof Error ? err : new Error(String(err))) as Error & {
      code?: string;
      meta?: ResponseMeta;
    };
    finish({ ok: false, browserId, meta: e.meta, error: e });
    throw err;
  }
}
