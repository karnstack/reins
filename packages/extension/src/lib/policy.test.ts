import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ensureAllowed,
  PolicyDenied,
  policy,
  resetPolicyCacheForTests,
  tightenPolicy,
} from "./policy.js";

type Listener = (changes: Record<string, unknown>, area: string) => void;

function stubStorage(initial?: unknown) {
  const store: Record<string, unknown> = initial === undefined ? {} : { reinsPolicy: initial };
  const listeners: Listener[] = [];
  vi.stubGlobal("chrome", {
    storage: {
      local: {
        get: async (key: string) => (key in store ? { [key]: store[key] } : {}),
        set: async (items: Record<string, unknown>) => {
          Object.assign(store, items);
          for (const l of listeners) l({ reinsPolicy: {} }, "local");
        },
      },
      onChanged: { addListener: (l: Listener) => listeners.push(l) },
    },
  });
  return store;
}

afterEach(() => {
  vi.unstubAllGlobals();
  resetPolicyCacheForTests();
});

describe("policy()", () => {
  it("defaults to full-everywhere when storage is empty", async () => {
    stubStorage();
    expect(await policy()).toEqual({ defaultTier: "full", rules: [] });
  });
  it("throws on corrupt storage (fail closed)", async () => {
    stubStorage({ defaultTier: "sideways", rules: "nope" });
    await expect(policy()).rejects.toThrow();
  });
  it("re-reads after a storage change (popup edit)", async () => {
    const store = stubStorage({ defaultTier: "full", rules: [] });
    expect((await policy()).rules).toHaveLength(0);
    store.reinsPolicy = {
      defaultTier: "full",
      rules: [{ pattern: "x.com", tier: "deny" }],
    };
    await chrome.storage.local.set({ poke: 1 }); // fires the listener
    expect((await policy()).rules).toHaveLength(1);
  });
});

describe("tightenPolicy", () => {
  it("adds a tightening rule and persists it", async () => {
    const store = stubStorage({ defaultTier: "full", rules: [] });
    const next = await tightenPolicy("GitHub.com", "read");
    expect(next.rules).toEqual([{ pattern: "github.com", tier: "read" }]);
    expect(store.reinsPolicy).toEqual(next);
  });
  it("tightens an existing rule in place", async () => {
    stubStorage({ defaultTier: "full", rules: [{ pattern: "x.com", tier: "read" }] });
    const next = await tightenPolicy("x.com", "deny");
    expect(next.rules).toEqual([{ pattern: "x.com", tier: "deny" }]);
  });
  it("rejects loosening an existing rule", async () => {
    stubStorage({ defaultTier: "full", rules: [{ pattern: "x.com", tier: "read" }] });
    await expect(tightenPolicy("x.com", "full")).rejects.toThrow(PolicyDenied);
  });
  it("rejects a no-op (equal tier)", async () => {
    stubStorage({ defaultTier: "read", rules: [] });
    await expect(tightenPolicy("x.com", "read")).rejects.toThrow(/already read/);
  });
  it("allows tightening below a covering wildcard", async () => {
    stubStorage({
      defaultTier: "read",
      rules: [{ pattern: "*.x.com", tier: "full" }],
    });
    const next = await tightenPolicy("a.x.com", "read");
    expect(next.rules).toContainEqual({ pattern: "a.x.com", tier: "read" });
  });
  it("rejects invalid patterns", async () => {
    stubStorage();
    await expect(tightenPolicy("foo.*.com", "deny")).rejects.toThrow(/invalid pattern/);
  });
});

describe("ensureAllowed", () => {
  it("full host allows read and full methods", async () => {
    stubStorage({ defaultTier: "full", rules: [] });
    await expect(ensureAllowed("click", "x.com")).resolves.toBeUndefined();
    await expect(ensureAllowed("read_text", "x.com")).resolves.toBeUndefined();
  });
  it("read host allows read, blocks full with popup hint", async () => {
    stubStorage({ defaultTier: "full", rules: [{ pattern: "x.com", tier: "read" }] });
    await expect(ensureAllowed("read_snapshot", "x.com")).resolves.toBeUndefined();
    await expect(ensureAllowed("click", "x.com")).rejects.toThrow(/x\.com is read-only.*popup/);
  });
  it("deny host blocks everything", async () => {
    stubStorage({ defaultTier: "full", rules: [{ pattern: "*.bank.com", tier: "deny" }] });
    await expect(ensureAllowed("read_text", "app.bank.com")).rejects.toThrow(
      /app\.bank\.com is denied/,
    );
  });
  it("undefined host uses the default tier", async () => {
    stubStorage({ defaultTier: "read", rules: [] });
    await expect(ensureAllowed("screenshot", undefined)).resolves.toBeUndefined();
    await expect(ensureAllowed("eval_js", undefined)).rejects.toThrow(PolicyDenied);
  });
  it("carries code policy_denied", async () => {
    stubStorage({ defaultTier: "deny", rules: [] });
    const err = await ensureAllowed("click", "x.com").catch((e: unknown) => e);
    expect((err as { code?: string }).code).toBe("policy_denied");
  });
});
