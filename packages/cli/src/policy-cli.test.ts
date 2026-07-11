import type { Policy } from "@reins/protocol";
import { describe, expect, it, vi } from "vitest";
import { policyText, runPolicy } from "./policy-cli.js";

const POLICY: Policy = {
  defaultTier: "full",
  rules: [
    { pattern: "*.bank.com", tier: "deny" },
    { pattern: "github.com", tier: "read" },
  ],
};

describe("policyText", () => {
  it("shows default, rules, and effective tier per open-tab host", () => {
    const text = policyText(POLICY, [
      { tabId: 1, title: "gh", url: "https://github.com/a", active: true },
      { tabId: 2, title: "", url: "", active: false, blocked: true },
      { tabId: 3, title: "x", url: "https://x.com/", active: false },
    ]);
    expect(text).toContain("default: full");
    expect(text).toContain("*.bank.com");
    expect(text).toMatch(/github\.com\s+read/);
    expect(text).toMatch(/x\.com\s+full/);
    expect(text).toContain("1 blocked tab");
  });
});

describe("runPolicy", () => {
  it("show: calls policy_get + list_tabs", async () => {
    const rpc = vi.fn(async (method: string) => (method === "policy_get" ? POLICY : { tabs: [] }));
    const out = await runPolicy([], { rpc });
    expect(rpc).toHaveBeenCalledWith("policy_get", {});
    expect(rpc).toHaveBeenCalledWith("list_tabs", {});
    expect(out).toContain("default: full");
  });

  it("deny: tightens via policy_tighten", async () => {
    const rpc = vi.fn(async () => ({ defaultTier: "full", rules: [] }));
    const out = await runPolicy(["deny", "evil.com"], { rpc });
    expect(rpc).toHaveBeenCalledWith("policy_tighten", { pattern: "evil.com", tier: "deny" });
    expect(out).toContain("evil.com");
  });

  it("readonly maps to tier read", async () => {
    const rpc = vi.fn(async () => ({ defaultTier: "full", rules: [] }));
    await runPolicy(["readonly", "*.corp.com"], { rpc });
    expect(rpc).toHaveBeenCalledWith("policy_tighten", { pattern: "*.corp.com", tier: "read" });
  });

  it("passes --browser through", async () => {
    const rpc = vi.fn(async () => ({ defaultTier: "full", rules: [] }));
    await runPolicy(["deny", "evil.com", "--browser", "b2"], { rpc });
    expect(rpc).toHaveBeenCalledWith("policy_tighten", {
      pattern: "evil.com",
      tier: "deny",
      browserId: "b2",
    });
  });

  it("allow: never calls rpc, explains the popup", async () => {
    const rpc = vi.fn();
    await expect(runPolicy(["allow", "x.com"], { rpc })).rejects.toThrow(
      /grants require the extension popup/,
    );
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects unknown subcommands and missing patterns", async () => {
    const rpc = vi.fn();
    await expect(runPolicy(["frobnicate"], { rpc })).rejects.toThrow(/usage/i);
    await expect(runPolicy(["deny"], { rpc })).rejects.toThrow(/pattern/i);
  });
});
