import { afterEach, describe, expect, it, vi } from "vitest";
import { closeTab, listTabs, selectTab } from "./tab-handler.js";

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

  it("carries groupId for grouped tabs, omits it for ungrouped (-1)", async () => {
    vi.stubGlobal("chrome", {
      tabs: {
        query: async () => [
          { id: 1, title: "a", url: "https://a", active: false, groupId: 7 },
          { id: 2, title: "b", url: "https://b", active: false, groupId: -1 },
        ],
      },
    });
    const { tabs } = await listTabs();
    expect(tabs[0]).toEqual({ tabId: 1, title: "a", url: "https://a", active: false, groupId: 7 });
    expect(tabs[1]).not.toHaveProperty("groupId");
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
