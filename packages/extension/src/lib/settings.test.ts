import { DEFAULT_PORT, PORT_RANGE } from "@reins/protocol";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { candidateUrls, loadSettings, portFromUrl, saveSettings } from "./settings.js";

const store = new Map<string, unknown>();
beforeEach(() => {
  store.clear();
  vi.stubGlobal("chrome", {
    storage: {
      local: {
        get: async (keys: string[]) => Object.fromEntries(keys.map((k) => [k, store.get(k)])),
        set: async (items: Record<string, unknown>) => {
          for (const [k, v] of Object.entries(items)) store.set(k, v);
        },
      },
    },
  });
});

describe("settings", () => {
  it("defaults to autoConnect with no cached ports", async () => {
    expect(await loadSettings()).toEqual({
      autoConnect: true,
      lastPort: undefined,
      portOverride: undefined,
    });
  });

  it("round-trips partial saves", async () => {
    await saveSettings({ autoConnect: false });
    await saveSettings({ lastPort: 8767 });
    const s = await loadSettings();
    expect(s.autoConnect).toBe(false);
    expect(s.lastPort).toBe(8767);
  });

  it("ignores garbage stored values", async () => {
    store.set("reinsLastPort", "nope");
    store.set("reinsPortOverride", -4);
    const s = await loadSettings();
    expect(s.lastPort).toBeUndefined();
    expect(s.portOverride).toBeUndefined();
  });
});

describe("candidateUrls", () => {
  it("walks the shared range by default", () => {
    const urls = candidateUrls({ autoConnect: true });
    expect(urls).toHaveLength(PORT_RANGE);
    expect(urls[0]).toBe(`ws://127.0.0.1:${DEFAULT_PORT}`);
  });

  it("tries the last-good port first, without duplicates", () => {
    const urls = candidateUrls({ autoConnect: true, lastPort: 8767 });
    expect(urls[0]).toBe("ws://127.0.0.1:8767");
    expect(urls).toHaveLength(PORT_RANGE);
  });

  it("a port override pins a single URL", () => {
    expect(candidateUrls({ autoConnect: true, portOverride: 9999 })).toEqual([
      "ws://127.0.0.1:9999",
    ]);
  });
});

describe("portFromUrl", () => {
  it("extracts the port", () => {
    expect(portFromUrl("ws://127.0.0.1:8766")).toBe(8766);
    expect(portFromUrl("not a url")).toBeUndefined();
  });
});
