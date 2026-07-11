import { describe, expect, it } from "vitest";
import type { Policy } from "@reins/protocol";
import { removeRule, setDefaultTier, upsertRule } from "./policy-view.js";

const base: Policy = { defaultTier: "full", rules: [{ pattern: "x.com", tier: "read" }] };

describe("upsertRule", () => {
  it("adds a normalized rule", () => {
    const next = upsertRule(base, "*.New.com", "deny");
    expect(next.rules).toContainEqual({ pattern: "*.new.com", tier: "deny" });
  });
  it("replaces an existing rule (either direction — popup may loosen)", () => {
    expect(upsertRule(base, "x.com", "full").rules).toEqual([{ pattern: "x.com", tier: "full" }]);
  });
  it("does not mutate the input", () => {
    upsertRule(base, "y.com", "deny");
    expect(base.rules).toHaveLength(1);
  });
});

describe("removeRule", () => {
  it("removes by pattern", () => {
    expect(removeRule(base, "x.com").rules).toEqual([]);
  });
});

describe("setDefaultTier", () => {
  it("replaces defaultTier only", () => {
    expect(setDefaultTier(base, "read")).toEqual({ ...base, defaultTier: "read" });
  });
});
