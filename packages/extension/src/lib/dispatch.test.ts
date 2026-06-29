import { afterEach, describe, expect, it, vi } from "vitest";

// vi.mock is hoisted by vitest so cdp.js is stubbed before any imports run.
vi.mock("./cdp.js", () => ({
  cdpNavigate: vi.fn(async () => ({ url: "https://x/" })),
  cdpSnapshot: vi.fn(async () => ({ content: "", refs: [] })),
  cdpClick: vi.fn(async () => ({ ok: true })),
  cdpType: vi.fn(async () => ({ ok: true })),
  cdpScreenshot: vi.fn(async () => ({ data: "abc123", mimeType: "image/png" })),
  cdpEval: vi.fn(async () => ({ value: 42 })),
  cdpWaitFor: vi.fn(async () => ({ ok: true })),
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
  it("routes screenshot to cdpScreenshot", async () => {
    expect(await dispatchMethod("screenshot", {})).toEqual({
      data: "abc123",
      mimeType: "image/png",
    });
  });
  it("routes eval_js to cdpEval", async () => {
    expect(await dispatchMethod("eval_js", { expression: "1+1" })).toEqual({ value: 42 });
  });
  it("routes wait_for to cdpWaitFor", async () => {
    expect(await dispatchMethod("wait_for", { selector: "#btn" })).toEqual({ ok: true });
  });
});

describe("dispatchMethod routing (chrome.tabs)", () => {
  it("routes open_tab", async () => {
    vi.stubGlobal("chrome", { tabs: { create: async () => ({ id: 11 }) } });
    const result = await dispatchMethod("open_tab", { url: "https://new.tab", activate: true });
    expect(result).toEqual({ tabId: 11 });
  });

  it("routes close_tab", async () => {
    const remove = vi.fn(async () => undefined);
    vi.stubGlobal("chrome", { tabs: { remove } });
    const result = await dispatchMethod("close_tab", { tabId: 5 });
    expect(remove).toHaveBeenCalledWith(5);
    expect(result).toEqual({ ok: true });
  });

  it("routes select_tab", async () => {
    const update = vi.fn(async () => ({}));
    vi.stubGlobal("chrome", { tabs: { update } });
    const result = await dispatchMethod("select_tab", { tabId: 7 });
    expect(update).toHaveBeenCalledWith(7, { active: true });
    expect(result).toEqual({ ok: true });
  });
});
