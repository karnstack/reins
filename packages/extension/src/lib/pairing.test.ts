import { afterEach, describe, expect, it, vi } from "vitest";
import { clearPairing, loadPairing, savePairing } from "./pairing.js";

function mockStorage() {
  const store = new Map<string, unknown>();
  vi.stubGlobal("chrome", {
    storage: {
      local: {
        get: async (keys: string[]) => {
          const out: Record<string, unknown> = {};
          for (const k of keys) if (store.has(k)) out[k] = store.get(k);
          return out;
        },
        set: async (items: Record<string, unknown>) => {
          for (const [k, v] of Object.entries(items)) store.set(k, v);
        },
        remove: async (keys: string[]) => {
          for (const k of keys) store.delete(k);
        },
      },
    },
  });
  return store;
}

afterEach(() => vi.unstubAllGlobals());

describe("pairing", () => {
  it("returns undefined when nothing is stored", async () => {
    mockStorage();
    expect(await loadPairing()).toBeUndefined();
  });

  it("round-trips a saved pairing", async () => {
    mockStorage();
    await savePairing({ url: "ws://127.0.0.1:8765", token: "abc" });
    expect(await loadPairing()).toEqual({ url: "ws://127.0.0.1:8765", token: "abc" });
  });

  it("clears a pairing", async () => {
    mockStorage();
    await savePairing({ url: "ws://x", token: "t" });
    await clearPairing();
    expect(await loadPairing()).toBeUndefined();
  });
});
