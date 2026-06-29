import { afterEach, describe, expect, it, vi } from "vitest";
import { closeTab, listTabs, openTab, selectTab } from "./tab-handler.js";

afterEach(() => vi.unstubAllGlobals());

describe("listTabs", () => {
  it("maps chrome tabs to the Tab shape", async () => {
    vi.stubGlobal("chrome", {
      tabs: {
        query: async () => [
          { id: 1, title: "Home", url: "https://a", active: true },
          { id: 2, title: "Docs", url: "https://b", active: false },
        ],
      },
    });
    const { tabs } = await listTabs();
    expect(tabs).toEqual([
      { tabId: 1, title: "Home", url: "https://a", active: true },
      { tabId: 2, title: "Docs", url: "https://b", active: false },
    ]);
  });

  it("fills defaults for missing fields", async () => {
    vi.stubGlobal("chrome", { tabs: { query: async () => [{}] } });
    const { tabs } = await listTabs();
    expect(tabs).toEqual([{ tabId: -1, title: "", url: "", active: false }]);
  });
});

describe("openTab", () => {
  it("calls chrome.tabs.create with url + active and returns tabId", async () => {
    const create = vi.fn(async () => ({ id: 42 }));
    vi.stubGlobal("chrome", { tabs: { create } });
    const result = await openTab({ url: "https://example.com", activate: true });
    expect(create).toHaveBeenCalledWith({ url: "https://example.com", active: true });
    expect(result).toEqual({ tabId: 42 });
  });

  it("falls back to tabId -1 when created tab has no id", async () => {
    vi.stubGlobal("chrome", { tabs: { create: async () => ({}) } });
    const result = await openTab({ url: "https://x", activate: false });
    expect(result).toEqual({ tabId: -1 });
  });
});

describe("closeTab", () => {
  it("calls chrome.tabs.remove with the tabId and returns { ok: true }", async () => {
    const remove = vi.fn(async () => undefined);
    vi.stubGlobal("chrome", { tabs: { remove } });
    const result = await closeTab({ tabId: 5 });
    expect(remove).toHaveBeenCalledWith(5);
    expect(result).toEqual({ ok: true });
  });
});

describe("selectTab", () => {
  it("calls chrome.tabs.update with active:true and returns { ok: true }", async () => {
    const update = vi.fn(async () => ({}));
    vi.stubGlobal("chrome", { tabs: { update } });
    const result = await selectTab({ tabId: 7 });
    expect(update).toHaveBeenCalledWith(7, { active: true });
    expect(result).toEqual({ ok: true });
  });
});
