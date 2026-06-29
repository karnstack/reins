import { afterEach, describe, expect, it, vi } from "vitest";
import { listTabs } from "./tab-handler.js";

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
