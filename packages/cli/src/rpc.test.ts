import { describe, expect, it, vi } from "vitest";
import type { AuditRecord } from "./audit.js";
import type { BridgePort } from "./bridge.js";
import { handleRpc, listAllGroups, listAllTabs, RpcBadRequest } from "./rpc.js";

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
      'unknown browserId "b9". Connected: b1 (Chrome)',
    );
  });
});

describe("listAllGroups", () => {
  const G = {
    groupId: 7,
    title: "reins",
    color: "blue",
    collapsed: false,
    windowId: 1,
    tabCount: 2,
  };
  const two = [
    { id: "b1", browser: "Chrome", connectedAt: 0 },
    { id: "b2", browser: "Chromium", connectedAt: 1 },
  ];

  it("aggregates across browsers with tags, via handleRpc", async () => {
    const bridge = fakeBridge({
      browsers: two,
      request: vi.fn(async () => ({ groups: [G] })),
    });
    const out = (await handleRpc(bridge, { method: "list_groups" })) as { groups: unknown[] };
    expect(out.groups).toEqual([
      { ...G, browserId: "b1", browser: "Chrome" },
      { ...G, browserId: "b2", browser: "Chromium" },
    ]);
  });

  const UNSUPPORTED_B2 =
    "Chromium (b2) doesn't support tab groups — reins groups/group/ungroup need the chrome.tabGroups API, which this browser doesn't provide. Other reins commands work normally.";
  const OUTDATED_B2 =
    "Chromium (b2)'s reins extension predates tab groups — update it (Chrome Web Store), or run `reins extension --reload` for an unpacked build.";

  function coded(message: string, code?: string): Error {
    const e = new Error(message) as Error & { code?: string };
    if (code) e.code = code;
    return e;
  }

  it("reports a browser that can't do tab groups in skipped, naming it", async () => {
    const bridge = fakeBridge({
      browsers: two,
      request: vi.fn(async (_m: string, _p: unknown, opts?: { browserId?: string }) => {
        if (opts?.browserId === "b2") {
          throw coded(
            "unsupported: this browser doesn't support tab groups (chrome.tabGroups unavailable)",
            "unsupported",
          );
        }
        return { groups: [G] };
      }),
    });
    const { groups, skipped } = await listAllGroups(bridge);
    expect(groups).toEqual([{ ...G, browserId: "b1", browser: "Chrome" }]);
    expect(skipped).toEqual([
      { browserId: "b2", browser: "Chromium", reason: "unsupported", message: UNSUPPORTED_B2 },
    ]);
  });

  it("reports an outdated extension in skipped", async () => {
    const bridge = fakeBridge({
      browsers: two,
      request: vi.fn(async (_m: string, _p: unknown, opts?: { browserId?: string }) => {
        if (opts?.browserId === "b2") {
          throw coded("HANDLER_ERROR: unknown method: list_groups", "HANDLER_ERROR");
        }
        return { groups: [G] };
      }),
    });
    const { skipped } = await listAllGroups(bridge);
    expect(skipped).toEqual([
      { browserId: "b2", browser: "Chromium", reason: "outdated", message: OUTDATED_B2 },
    ]);
  });

  it("reports a generic failure in skipped with the raw message", async () => {
    const bridge = fakeBridge({
      browsers: two,
      request: vi.fn(async (_m: string, _p: unknown, opts?: { browserId?: string }) => {
        if (opts?.browserId === "b2") throw new Error('request "list_groups" timed out after 5ms');
        return { groups: [G] };
      }),
    });
    const { skipped } = await listAllGroups(bridge);
    expect(skipped).toEqual([
      {
        browserId: "b2",
        browser: "Chromium",
        reason: "error",
        message: 'request "list_groups" timed out after 5ms',
      },
    ]);
  });

  it("rethrows the first failure, named, when every browser fails", async () => {
    const bridge = fakeBridge({
      browsers: [{ id: "b2", browser: "Chromium", connectedAt: 1 }],
      request: vi.fn(async () => {
        throw coded(
          "unsupported: this browser doesn't support tab groups (chrome.tabGroups unavailable)",
          "unsupported",
        );
      }),
    });
    const p = listAllGroups(bridge);
    await expect(p).rejects.toThrow(UNSUPPORTED_B2);
    await expect(p).rejects.toMatchObject({ code: "unsupported" });
  });

  it("handleRpc list_groups always returns skipped", async () => {
    const bridge = fakeBridge({ request: vi.fn(async () => ({ groups: [G] })) });
    const out = await handleRpc(bridge, { method: "list_groups" });
    expect(out).toEqual({ groups: [{ ...G, browserId: "b1", browser: "Chrome" }], skipped: [] });
  });

  it("returns [] with no browsers connected", async () => {
    expect(await listAllGroups(fakeBridge({ browsers: [] }))).toEqual({ groups: [], skipped: [] });
  });

  it("errors on an unknown browserId", async () => {
    await expect(listAllGroups(fakeBridge(), "b9")).rejects.toThrow('unknown browserId "b9"');
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
      browserId?: string;
    };
    err.code = "policy_denied";
    err.meta = { host: "bank.com", tier: "read", tabId: 7 };
    err.browserId = "b1";
    const bridge = fakeBridge({
      browsers: [{ id: "b1", browser: "Chromium", connectedAt: 0 }],
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
      browserId: "b1",
      browser: "Chromium",
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
      handleRpc(bridge, { method: "click", params: { tabId: 412 } }, (r) => records.push(r)),
    ).rejects.toThrow();
    expect(records[0]).toMatchObject({
      method: "click",
      ok: false,
      error: "extension not connected",
      tabId: 412,
    });
    expect(records[0]?.browserId).toBeUndefined();
    expect(records[0]?.host).toBeUndefined();
    expect(records[0]?.tier).toBeUndefined();
    expect(records[0]?.denied).toBeUndefined();
  });

  it("names the browser when a routed group method is unsupported, in the error and audit", async () => {
    const records: AuditRecord[] = [];
    const err = new Error(
      "unsupported: this browser doesn't support tab groups (chrome.tabGroups unavailable)",
    ) as Error & { code?: string; meta?: unknown; browserId?: string };
    err.code = "unsupported";
    err.meta = { host: "app.example.com", tier: "full", tabId: 7 };
    err.browserId = "b1";
    const bridge = fakeBridge({
      requestFull: async () => {
        throw err;
      },
    });
    const expected =
      "Chrome (b1) doesn't support tab groups — reins groups/group/ungroup need the chrome.tabGroups API, which this browser doesn't provide. Other reins commands work normally.";
    const p = handleRpc(bridge, { method: "group_tabs", params: { tabIds: [7] } }, (r) =>
      records.push(r),
    );
    await expect(p).rejects.toThrow(expected);
    await expect(p).rejects.toMatchObject({
      code: "unsupported",
      browserId: "b1",
      meta: { host: "app.example.com", tier: "full", tabId: 7 },
    });
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      method: "group_tabs",
      ok: false,
      browserId: "b1",
      browser: "Chrome",
      host: "app.example.com",
      error: expected,
    });
  });

  it("leaves an unsupported error on a non-group method untouched", async () => {
    const err = new Error("unsupported: nope") as Error & { code?: string; browserId?: string };
    err.code = "unsupported";
    err.browserId = "b1";
    const bridge = fakeBridge({
      requestFull: async () => {
        throw err;
      },
    });
    const p = handleRpc(bridge, { method: "click", params: {} });
    await expect(p).rejects.toThrow("unsupported: nope");
    await expect(p).rejects.toBe(err);
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
