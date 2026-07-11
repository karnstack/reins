import { afterEach, describe, expect, it, vi } from "vitest";

// vi.mock is hoisted by vitest so cdp.js is stubbed before any imports run.
vi.mock("./monitor.js", () => ({
  readConsole: vi.fn(async () => ({
    entries: [{ level: "error", text: "boom", timestamp: 1000 }],
  })),
  readNetwork: vi.fn(async () => ({
    entries: [{ method: "GET", url: "https://x/", status: 200, timestamp: 2000 }],
  })),
}));

vi.mock("./cdp.js", () => ({
  resolveTabId: vi.fn(async (tabId?: number) => tabId ?? 1),
  cdpNavigate: vi.fn(async () => ({ url: "https://x/" })),
  cdpSnapshot: vi.fn(async () => ({ content: "", refs: [] })),
  cdpClick: vi.fn(async () => ({ ok: true })),
  cdpType: vi.fn(async () => ({ ok: true })),
  cdpScreenshot: vi.fn(async () => ({ data: "abc123", mimeType: "image/png" })),
  cdpEval: vi.fn(async () => ({ value: 42 })),
  cdpWaitFor: vi.fn(async () => ({ ok: true })),
}));

vi.mock("./page-actions.js", () => ({
  pressKey: vi.fn(async () => ({ ok: true })),
  hover: vi.fn(async () => ({ ok: true })),
  scroll: vi.fn(async () => ({ ok: true })),
  fill: vi.fn(async () => ({ ok: true })),
  selectOption: vi.fn(async () => ({ ok: true })),
  upload: vi.fn(async () => ({ ok: true })),
  readText: vi.fn(async () => ({ text: "body text" })),
  handleDialog: vi.fn(async () => ({ ok: true })),
  cdpRaw: vi.fn(async () => ({ result: { frameId: "F1" } })),
}));

// Allow-all policy by default so routing tests exercise handlers, not the gate.
vi.mock("./policy.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("./policy.js")>();
  return {
    ...real,
    policy: vi.fn(async () => ({ defaultTier: "full", rules: [] })),
    ensureAllowed: vi.fn(async () => undefined),
    tightenPolicy: vi.fn(async (pattern: string, tier: string) => ({
      defaultTier: "full",
      rules: [{ pattern, tier }],
    })),
  };
});

import { cdpClick } from "./cdp.js";
import { dispatchMethod, dispatchWithMeta } from "./dispatch.js";
import { ensureAllowed, PolicyDenied, policy, tightenPolicy } from "./policy.js";

/** chrome stub with enough tabs API for the gate (tabs.get → host). */
function stubTabs(url = "https://x.com/") {
  vi.stubGlobal("chrome", {
    tabs: {
      get: async (id: number) => ({ id, url }),
      query: async () => [{ id: 1, title: "t", url, active: true }],
      create: async () => ({ id: 11 }),
      remove: async () => undefined,
      update: async () => ({}),
    },
    windows: { update: async () => ({}) },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

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

describe("dispatchMethod routing (CDP)", () => {
  it("routes navigate to cdpNavigate", async () => {
    stubTabs();
    expect(await dispatchMethod("navigate", { to: "https://x" })).toEqual({ url: "https://x/" });
  });
  it("routes click/type/read_snapshot", async () => {
    stubTabs();
    expect(await dispatchMethod("click", { ref: "e1" })).toEqual({ ok: true });
    expect(await dispatchMethod("type", { ref: "e1", text: "hi" })).toEqual({ ok: true });
    expect(await dispatchMethod("read_snapshot", {})).toEqual({ content: "", refs: [] });
  });
  it("routes screenshot to cdpScreenshot", async () => {
    stubTabs();
    expect(await dispatchMethod("screenshot", {})).toEqual({
      data: "abc123",
      mimeType: "image/png",
    });
  });
  it("routes eval_js to cdpEval", async () => {
    stubTabs();
    expect(await dispatchMethod("eval_js", { expression: "1+1" })).toEqual({ value: 42 });
  });
  it("routes wait_for to cdpWaitFor", async () => {
    stubTabs();
    expect(await dispatchMethod("wait_for", { selector: "#btn" })).toEqual({ ok: true });
  });
});

describe("dispatchMethod routing (chrome.tabs)", () => {
  it("routes open_tab", async () => {
    vi.stubGlobal("chrome", { tabs: { create: async () => ({ id: 11 }) } });
    const result = await dispatchMethod("open_tab", { url: "https://new.tab", activate: true });
    expect(result).toEqual({ tabId: 11 });
  });

  it("routes close_tab", async () => {
    const remove = vi.fn(async () => undefined);
    vi.stubGlobal("chrome", {
      tabs: { remove, get: async (id: number) => ({ id, url: "https://x.com/" }) },
    });
    const result = await dispatchMethod("close_tab", { tabId: 5 });
    expect(remove).toHaveBeenCalledWith(5);
    expect(result).toEqual({ ok: true });
  });

  it("routes select_tab", async () => {
    const update = vi.fn(async () => ({}));
    vi.stubGlobal("chrome", {
      tabs: { update, get: async (id: number) => ({ id, url: "https://x.com/" }) },
    });
    const result = await dispatchMethod("select_tab", { tabId: 7 });
    expect(update).toHaveBeenCalledWith(7, { active: true });
    expect(result).toEqual({ ok: true });
  });
});

describe("dispatchMethod routing (page-actions)", () => {
  it.each([
    ["press_key", { key: "Escape" }, { ok: true }],
    ["hover", { ref: "e1" }, { ok: true }],
    ["scroll", { to: "bottom" }, { ok: true }],
    ["fill", { ref: "e1", value: "x" }, { ok: true }],
    ["select_option", { ref: "e1", value: "IN" }, { ok: true }],
    ["upload", { ref: "e1", files: ["/tmp/a"] }, { ok: true }],
    ["read_text", {}, { text: "body text" }],
    ["handle_dialog", { accept: true }, { ok: true }],
    ["cdp", { method: "Page.enable" }, { result: { frameId: "F1" } }],
  ] as const)("routes %s", async (method, params, expected) => {
    stubTabs();
    expect(await dispatchMethod(method, params)).toEqual(expected);
  });

  it("routes resize to chrome.windows.update", async () => {
    const update = vi.fn(async () => ({}));
    vi.stubGlobal("chrome", {
      tabs: { get: async () => ({ id: 5, windowId: 3, url: "https://x.com/" }) },
      windows: { update },
    });
    expect(await dispatchMethod("resize", { tabId: 5, width: 1280, height: 800 })).toEqual({
      ok: true,
    });
    expect(update).toHaveBeenCalledWith(3, { width: 1280, height: 800 });
  });
});

describe("dispatchMethod routing (monitor)", () => {
  it("routes read_console to readConsole", async () => {
    stubTabs();
    expect(await dispatchMethod("read_console", {})).toEqual({
      entries: [{ level: "error", text: "boom", timestamp: 1000 }],
    });
  });
  it("routes read_network to readNetwork", async () => {
    stubTabs();
    expect(await dispatchMethod("read_network", {})).toEqual({
      entries: [{ method: "GET", url: "https://x/", status: 200, timestamp: 2000 }],
    });
  });
});

describe("policy gate", () => {
  it("checks the resolved tab's host for tab-scoped methods", async () => {
    stubTabs("https://app.example.com/page");
    await dispatchMethod("click", { ref: "e1" });
    expect(ensureAllowed).toHaveBeenCalledWith("click", "app.example.com");
  });

  it("pins the resolved tabId into handler params", async () => {
    stubTabs();
    await dispatchMethod("click", { ref: "e1" });
    expect(cdpClick).toHaveBeenCalledWith(expect.objectContaining({ tabId: 1 }));
  });

  it("checks the destination host for open_tab", async () => {
    stubTabs();
    await dispatchMethod("open_tab", { url: "https://new.site/x", activate: true });
    expect(ensureAllowed).toHaveBeenCalledWith("open_tab", "new.site");
  });

  it("checks current AND destination hosts for navigate", async () => {
    stubTabs("https://here.com/");
    await dispatchMethod("navigate", { to: "https://there.com/x" });
    expect(ensureAllowed).toHaveBeenCalledWith("navigate", "here.com");
    expect(ensureAllowed).toHaveBeenCalledWith("navigate", "there.com");
  });

  it("checks only the current host for back/forward/reload", async () => {
    stubTabs("https://here.com/");
    await dispatchMethod("navigate", { to: "back" });
    expect(ensureAllowed).toHaveBeenCalledTimes(1);
    expect(ensureAllowed).toHaveBeenCalledWith("navigate", "here.com");
  });

  it("resolves protocol-relative navigate targets against the current page", async () => {
    stubTabs("https://here.com/");
    await dispatchMethod("navigate", { to: "//there.com/x" });
    expect(ensureAllowed).toHaveBeenCalledWith("navigate", "there.com");
  });

  it("propagates PolicyDenied from the gate", async () => {
    stubTabs();
    vi.mocked(ensureAllowed).mockRejectedValueOnce(
      new PolicyDenied("blocked by policy: x.com is read-only"),
    );
    await expect(dispatchMethod("click", { ref: "e1" })).rejects.toThrow(/blocked by policy/);
  });
});

describe("list_tabs redaction", () => {
  it("redacts denied tabs, passes others through", async () => {
    vi.stubGlobal("chrome", {
      tabs: {
        query: async () => [
          { id: 1, title: "Bank", url: "https://app.bank.com/x", active: true },
          { id: 2, title: "Docs", url: "https://docs.example.com", active: false },
        ],
      },
    });
    vi.mocked(policy).mockResolvedValueOnce({
      defaultTier: "full",
      rules: [{ pattern: "*.bank.com", tier: "deny" }],
    });
    expect(await dispatchMethod("list_tabs", {})).toEqual({
      tabs: [
        { tabId: 1, title: "", url: "", active: true, blocked: true },
        { tabId: 2, title: "Docs", url: "https://docs.example.com", active: false },
      ],
    });
  });
});

describe("policy methods", () => {
  it("policy_get returns the policy", async () => {
    expect(await dispatchMethod("policy_get", {})).toEqual({
      defaultTier: "full",
      rules: [],
    });
  });
  it("policy_tighten validates params and delegates", async () => {
    expect(await dispatchMethod("policy_tighten", { pattern: "x.com", tier: "read" })).toEqual({
      defaultTier: "full",
      rules: [{ pattern: "x.com", tier: "read" }],
    });
    expect(tightenPolicy).toHaveBeenCalledWith("x.com", "read");
  });
  it("policy_tighten rejects a bad tier", async () => {
    await expect(
      dispatchMethod("policy_tighten", { pattern: "x.com", tier: "sideways" }),
    ).rejects.toThrow();
  });
});

describe("dispatchWithMeta", () => {
  it("stamps host/tier/tabId on success", async () => {
    stubTabs("https://app.example.com/x");
    vi.mocked(ensureAllowed).mockResolvedValueOnce("full");
    const out = await dispatchWithMeta("read_text", { tabId: 7 });
    expect(out.meta).toEqual({ host: "app.example.com", tier: "full", tabId: 7 });
  });

  it("stamps meta (with tabId) on a policy denial", async () => {
    stubTabs("https://bank.com/x");
    vi.mocked(ensureAllowed).mockImplementationOnce(async () => {
      const err = new PolicyDenied("blocked by policy: bank.com is read-only");
      err.meta = { host: "bank.com", tier: "read" };
      throw err;
    });
    const err = await dispatchWithMeta("click", { tabId: 7 }).catch((e) => e);
    expect(err.code).toBe("policy_denied");
    expect(err.meta).toEqual({ host: "bank.com", tier: "read", tabId: 7 });
  });

  it("leaves meta undefined for policy_get", async () => {
    const out = await dispatchWithMeta("policy_get", {});
    expect(out.meta).toBeUndefined();
  });

  it("dispatchMethod still returns the bare result", async () => {
    stubTabs();
    const result = await dispatchMethod("read_text", { tabId: 7 });
    expect(result).not.toHaveProperty("meta");
  });
});
