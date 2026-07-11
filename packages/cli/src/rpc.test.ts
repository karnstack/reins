import { describe, expect, it, vi } from "vitest";
import type { AuditRecord } from "./audit.js";
import type { BridgePort } from "./bridge.js";
import { handleRpc, listAllTabs, RpcBadRequest } from "./rpc.js";

function fakeBridge(overrides: Partial<BridgePort> = {}): BridgePort {
  return {
    paired: true,
    browsers: [{ id: "b1", browser: "Chrome", connectedAt: 0 }],
    request: vi.fn(async (method: string) => {
      if (method === "list_tabs") {
        return { tabs: [{ tabId: 1, title: "t", url: "https://x", active: true }] };
      }
      return { ok: true };
    }),
    requestFull: vi.fn(async (method: string) => ({
      result:
        method === "list_tabs"
          ? { tabs: [{ tabId: 1, title: "t", url: "https://x", active: true }] }
          : { ok: true },
      browserId: "b1",
    })),
    ...overrides,
  } as BridgePort;
}

describe("handleRpc", () => {
  it("routes a method with its params, splitting browserId off", async () => {
    const bridge = fakeBridge();
    const result = await handleRpc(bridge, {
      method: "click",
      params: { browserId: "b1", ref: "e1" },
    });
    expect(result).toEqual({ ok: true });
    expect(bridge.requestFull).toHaveBeenCalledWith("click", { ref: "e1" }, { browserId: "b1" });
  });

  it("passes params through untouched when browserId is absent", async () => {
    const bridge = fakeBridge();
    await handleRpc(bridge, { method: "type", params: { ref: "e1", text: "hi" } });
    expect(bridge.requestFull).toHaveBeenCalledWith(
      "type",
      { ref: "e1", text: "hi" },
      { browserId: undefined },
    );
  });

  it("defaults params to {}", async () => {
    const bridge = fakeBridge();
    await handleRpc(bridge, { method: "screenshot" });
    expect(bridge.requestFull).toHaveBeenCalledWith("screenshot", {}, { browserId: undefined });
  });

  it("aggregates list_tabs across browsers with tags", async () => {
    const bridge = fakeBridge({
      browsers: [
        { id: "b1", browser: "Chrome", connectedAt: 0 },
        { id: "b2", browser: "Brave", connectedAt: 1 },
      ],
    });
    const result = (await handleRpc(bridge, { method: "list_tabs" })) as { tabs: unknown[] };
    expect(result.tabs).toHaveLength(2);
    expect(result.tabs[0]).toMatchObject({ browserId: "b1", browser: "Chrome" });
    expect(result.tabs[1]).toMatchObject({ browserId: "b2", browser: "Brave" });
  });

  it("rejects malformed bodies with RpcBadRequest", async () => {
    const bridge = fakeBridge();
    for (const body of [null, 42, "x", {}, { method: "" }, { method: "x", params: [] }]) {
      await expect(handleRpc(bridge, body), JSON.stringify(body)).rejects.toBeInstanceOf(
        RpcBadRequest,
      );
    }
  });
});

describe("listAllTabs", () => {
  it("filters to one browser when browserId is given", async () => {
    const bridge = fakeBridge({
      browsers: [
        { id: "b1", browser: "Chrome", connectedAt: 0 },
        { id: "b2", browser: "Brave", connectedAt: 1 },
      ],
    });
    const tabs = await listAllTabs(bridge, "b2");
    expect(tabs).toHaveLength(1);
    expect(tabs[0]).toMatchObject({ browserId: "b2", browser: "Brave" });
  });

  it("errors on an unknown browserId, naming the roster", async () => {
    const bridge = fakeBridge();
    await expect(listAllTabs(bridge, "b9")).rejects.toThrow(
      'unknown browserId "b9" — connected: b1 (Chrome)',
    );
  });
});

describe("audit hook", () => {
  it("records a successful action with meta, browser name, and redacted params", async () => {
    const records: AuditRecord[] = [];
    const bridge = fakeBridge({
      browsers: [{ id: "b1", browser: "Chromium", connectedAt: 1 }],
      requestFull: async () => ({
        result: { ok: true },
        meta: { host: "app.example.com", tier: "full", tabId: 7 },
        browserId: "b1",
      }),
    });
    await handleRpc(bridge, { method: "type", params: { text: "hunter2", tabId: 7 } }, (r) =>
      records.push(r),
    );
    expect(records).toHaveLength(1);
    const r = records[0] as AuditRecord;
    expect(r).toMatchObject({
      method: "type",
      ok: true,
      browserId: "b1",
      browser: "Chromium",
      host: "app.example.com",
      tier: "full",
      tabId: 7,
      params: { text: "[redacted 7 chars]", tabId: 7 },
    });
    expect(r.denied).toBeUndefined();
    expect(r.ms).toBeGreaterThanOrEqual(0);
    expect(() => new Date(r.ts).toISOString()).not.toThrow();
  });

  it("records a policy denial with denied: true", async () => {
    const records: AuditRecord[] = [];
    const err = new Error("policy_denied: blocked by policy: bank.com is read-only") as Error & {
      code?: string;
      meta?: unknown;
    };
    err.code = "policy_denied";
    err.meta = { host: "bank.com", tier: "read", tabId: 7 };
    const bridge = fakeBridge({
      requestFull: async () => {
        throw err;
      },
    });
    await expect(
      handleRpc(bridge, { method: "click", params: {} }, (r) => records.push(r)),
    ).rejects.toThrow();
    expect(records[0]).toMatchObject({
      method: "click",
      ok: false,
      denied: true,
      host: "bank.com",
      tier: "read",
      tabId: 7,
      error: "policy_denied: blocked by policy: bank.com is read-only",
    });
  });

  it("records daemon-side failures without meta", async () => {
    const records: AuditRecord[] = [];
    const bridge = fakeBridge({
      requestFull: async () => {
        throw new Error("extension not connected");
      },
    });
    await expect(
      handleRpc(bridge, { method: "click", params: {} }, (r) => records.push(r)),
    ).rejects.toThrow();
    expect(records[0]).toMatchObject({
      method: "click",
      ok: false,
      error: "extension not connected",
    });
    expect(records[0]?.host).toBeUndefined();
    expect(records[0]?.denied).toBeUndefined();
  });

  it("audits list_tabs as one aggregate line without host", async () => {
    const records: AuditRecord[] = [];
    const bridge = fakeBridge();
    await handleRpc(bridge, { method: "list_tabs" }, (r) => records.push(r));
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ method: "list_tabs", ok: true });
    expect(records[0]?.host).toBeUndefined();
  });

  it("never lets a throwing hook affect the RPC result or double-record", async () => {
    let calls = 0;
    const bridge = fakeBridge();
    const result = await handleRpc(bridge, { method: "click", params: { ref: "e1" } }, () => {
      calls++;
      throw new Error("boom");
    });
    expect(result).toEqual({ ok: true });
    expect(calls).toBe(1);
  });

  it("does not audit malformed bodies", async () => {
    const records: AuditRecord[] = [];
    await expect(handleRpc(fakeBridge({}), { nope: 1 }, (r) => records.push(r))).rejects.toThrow();
    expect(records).toHaveLength(0);
  });
});
