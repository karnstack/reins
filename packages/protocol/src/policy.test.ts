import { describe, expect, it } from "vitest";
import {
  DEFAULT_POLICY,
  effectiveTier,
  hostOf,
  METHOD_TIERS,
  normalizePattern,
  type Policy,
  tighterThan,
} from "./policy.js";

describe("tighterThan", () => {
  it("orders deny < read < full", () => {
    expect(tighterThan("deny", "read")).toBe(true);
    expect(tighterThan("read", "full")).toBe(true);
    expect(tighterThan("deny", "full")).toBe(true);
    expect(tighterThan("full", "read")).toBe(false);
    expect(tighterThan("read", "read")).toBe(false);
  });
});

describe("normalizePattern", () => {
  it("lowercases and strips scheme, port, path", () => {
    expect(normalizePattern("HTTPS://GitHub.com:443/foo")).toBe("github.com");
    expect(normalizePattern("localhost:3000")).toBe("localhost");
  });
  it("keeps a single leading wildcard", () => {
    expect(normalizePattern("*.Google.com")).toBe("*.google.com");
  });
  it.each(["foo.*.com", "*", "a b.com", "", "*.", "https://"])("rejects %j", (bad) =>
    expect(() => normalizePattern(bad)).toThrow(/invalid pattern/));
});

describe("hostOf", () => {
  it("returns lowercase host for http(s)", () => {
    expect(hostOf("https://App.Example.com/x?y")).toBe("app.example.com");
    expect(hostOf("http://localhost:3000/")).toBe("localhost");
  });
  it("returns undefined for non-http(s) and garbage", () => {
    expect(hostOf("chrome://settings")).toBeUndefined();
    expect(hostOf("about:blank")).toBeUndefined();
    expect(hostOf("not a url")).toBeUndefined();
    expect(hostOf("")).toBeUndefined();
  });
});

describe("effectiveTier", () => {
  const policy: Policy = {
    defaultTier: "full",
    rules: [
      { pattern: "*.bank.com", tier: "deny" },
      { pattern: "app.bank.com", tier: "read" },
      { pattern: "*.corp.bank.com", tier: "read" },
      { pattern: "github.com", tier: "read" },
    ],
  };
  it("exact rule beats wildcard", () => {
    expect(effectiveTier(policy, "app.bank.com")).toBe("read");
  });
  it("longest wildcard wins", () => {
    expect(effectiveTier(policy, "x.corp.bank.com")).toBe("read");
    expect(effectiveTier(policy, "other.bank.com")).toBe("deny");
  });
  it("wildcard matches the apex", () => {
    expect(effectiveTier(policy, "bank.com")).toBe("deny");
  });
  it("falls back to defaultTier", () => {
    expect(effectiveTier(policy, "example.com")).toBe("full");
    expect(effectiveTier(policy, undefined)).toBe("full");
  });
  it("exact host rule does not match subdomains", () => {
    expect(effectiveTier(policy, "gist.github.com")).toBe("full");
  });
  it("DEFAULT_POLICY allows everything", () => {
    expect(effectiveTier(DEFAULT_POLICY, "anything.com")).toBe("full");
  });
});

describe("METHOD_TIERS", () => {
  it("classifies exactly the 23 bridge methods", () => {
    const read = [
      "list_tabs",
      "read_snapshot",
      "read_text",
      "screenshot",
      "read_console",
      "read_network",
      "wait_for",
    ];
    const full = [
      "navigate",
      "open_tab",
      "close_tab",
      "select_tab",
      "click",
      "type",
      "press_key",
      "hover",
      "scroll",
      "fill",
      "select_option",
      "upload",
      "resize",
      "handle_dialog",
      "eval_js",
      "cdp",
    ];
    for (const m of read) expect(METHOD_TIERS[m as keyof typeof METHOD_TIERS]).toBe("read");
    for (const m of full) expect(METHOD_TIERS[m as keyof typeof METHOD_TIERS]).toBe("full");
    expect(Object.keys(METHOD_TIERS)).toHaveLength(read.length + full.length);
  });
});
