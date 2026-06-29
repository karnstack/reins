import { afterEach, describe, expect, it, vi } from "vitest";

// vi.mock is hoisted by vitest so cdp.js is stubbed before any imports run.
vi.mock("./cdp.js", () => ({
  cdpNavigate: vi.fn(async () => ({ url: "https://x/" })),
  cdpSnapshot: vi.fn(async () => ({ content: "", refs: [] })),
  cdpClick: vi.fn(async () => ({ ok: true })),
  cdpType: vi.fn(async () => ({ ok: true })),
}));

import { dispatchMethod } from "./dispatch.js";

afterEach(() => vi.unstubAllGlobals());

describe("dispatchMethod", () => {
  it("list_tabs returns mapped tabs", async () => {
    vi.stubGlobal("chrome", {
      tabs: {
        query: async () => [
          { id: 1, title: "Home", url: "https://example.com", active: true },
          { id: 2, title: "Docs", url: "https://docs.example.com", active: false },
        ],
      },
    });
    const result = await dispatchMethod("list_tabs", {});
    expect(result).toEqual({
      tabs: [
        { tabId: 1, title: "Home", url: "https://example.com", active: true },
        { tabId: 2, title: "Docs", url: "https://docs.example.com", active: false },
      ],
    });
  });

  it("unknown method rejects with /unknown method/", async () => {
    await expect(dispatchMethod("foo_bar", {})).rejects.toThrow(/unknown method/);
  });
});

describe("dispatchMethod routing (CDP)", () => {
  it("routes navigate to cdpNavigate", async () => {
    expect(await dispatchMethod("navigate", { to: "https://x" })).toEqual({ url: "https://x/" });
  });
  it("routes click/type/read_snapshot", async () => {
    expect(await dispatchMethod("click", { ref: "e1" })).toEqual({ ok: true });
    expect(await dispatchMethod("type", { ref: "e1", text: "hi" })).toEqual({ ok: true });
    expect(await dispatchMethod("read_snapshot", {})).toEqual({ content: "", refs: [] });
  });
});
