import { describe, expect, it, vi } from "vitest";
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
    requestFull: vi.fn(async () => ({ result: undefined, browserId: "b1" })),
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
    expect(bridge.request).toHaveBeenCalledWith("click", { ref: "e1" }, { browserId: "b1" });
  });

  it("passes params through untouched when browserId is absent", async () => {
    const bridge = fakeBridge();
    await handleRpc(bridge, { method: "type", params: { ref: "e1", text: "hi" } });
    expect(bridge.request).toHaveBeenCalledWith(
      "type",
      { ref: "e1", text: "hi" },
      { browserId: undefined },
    );
  });

  it("defaults params to {}", async () => {
    const bridge = fakeBridge();
    await handleRpc(bridge, { method: "screenshot" });
    expect(bridge.request).toHaveBeenCalledWith("screenshot", {}, { browserId: undefined });
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
