import { afterEach, describe, expect, it, vi } from "vitest";
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
