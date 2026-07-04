import { afterEach, describe, expect, it, vi } from "vitest";

// cdp.ts (imported by page-actions) checks the monitor before attaching.
vi.mock("./monitor.js", () => ({ isMonitored: () => false }));

import {
  cdpRaw,
  fill,
  handleDialog,
  hover,
  pressKey,
  readText,
  scroll,
  selectOption,
  upload,
} from "./page-actions.js";
import { resizeWindow } from "./tab-handler.js";

type Call = { method: string; params?: Record<string, unknown> };

/** Fake chrome with a scripted CDP: respond(method, params) → result. */
function stubChrome(respond: (method: string, params?: Record<string, unknown>) => unknown) {
  const calls: Call[] = [];
  vi.stubGlobal("chrome", {
    debugger: {
      attach: async () => {},
      detach: async () => {},
      sendCommand: async (_target: unknown, method: string, params?: Record<string, unknown>) => {
        calls.push({ method, params });
        return respond(method, params);
      },
    },
    tabs: {
      query: async () => [{ id: 7, active: true }],
      get: async (tabId: number) => ({ id: tabId, windowId: 99 }),
    },
    windows: { update: vi.fn(async () => ({})) },
  });
  return calls;
}

const evalOk = (value: unknown) => ({ result: { value } });

afterEach(() => vi.unstubAllGlobals());

describe("pressKey", () => {
  it("dispatches keyDown+keyUp with parsed key and modifiers", async () => {
    const calls = stubChrome(() => ({}));
    await pressKey({ key: "Meta+A", tabId: 1 });
    const keyEvents = calls.filter((c) => c.method === "Input.dispatchKeyEvent");
    expect(keyEvents.map((c) => c.params?.type)).toEqual(["keyDown", "keyUp"]);
    expect(keyEvents[0]?.params).toMatchObject({ key: "A", code: "KeyA", modifiers: 4 });
  });

  it("rejects bad key specs before touching the debugger", async () => {
    const calls = stubChrome(() => ({}));
    await expect(pressKey({ key: "Hyper+X", tabId: 1 })).rejects.toThrow("unknown modifier");
    expect(calls).toHaveLength(0);
  });
});

describe("hover", () => {
  it("resolves the element center then dispatches mouseMoved", async () => {
    const calls = stubChrome((method) =>
      method === "Runtime.evaluate" ? evalOk({ x: 10, y: 20 }) : {},
    );
    await hover({ ref: "e1", tabId: 1 });
    const move = calls.find((c) => c.method === "Input.dispatchMouseEvent");
    expect(move?.params).toMatchObject({ type: "mouseMoved", x: 10, y: 20 });
  });

  it("errors when the element is missing", async () => {
    stubChrome((method) => (method === "Runtime.evaluate" ? evalOk(null) : {}));
    await expect(hover({ selector: "#gone", tabId: 1 })).rejects.toThrow("element not found: #gone");
  });
});

describe("scroll", () => {
  it("scrolls an element into view via ref", async () => {
    const calls = stubChrome(() => evalOk(true));
    await scroll({ ref: "e3", tabId: 1 });
    expect(calls[0]?.params?.expression).toContain("data-reins-ref");
    expect(calls[0]?.params?.expression).toContain("scrollIntoView");
  });

  it("scrolls the window by dx,dy", async () => {
    const calls = stubChrome(() => evalOk(true));
    await scroll({ by: { dx: 0, dy: 600 }, tabId: 1 });
    expect(calls[0]?.params?.expression).toContain("window.scrollBy(0, 600)");
  });

  it("scrolls to the bottom of the document", async () => {
    const calls = stubChrome(() => evalOk(true));
    await scroll({ to: "bottom", tabId: 1 });
    expect(calls[0]?.params?.expression).toContain("scrollHeight");
  });
});

describe("fill", () => {
  it("uses the native value setter and fires input+change", async () => {
    const calls = stubChrome(() => evalOk(true));
    await fill({ selector: "#name", value: "Karn", tabId: 1 });
    const expr = String(calls[0]?.params?.expression);
    expect(expr).toContain("getOwnPropertyDescriptor");
    expect(expr).toContain('new Event("input", { bubbles: true })');
    expect(expr).toContain('new Event("change", { bubbles: true })');
    expect(expr).toContain('"Karn"');
  });

  it("errors when the element is missing", async () => {
    stubChrome(() => evalOk(false));
    await expect(fill({ selector: "#gone", value: "x", tabId: 1 })).rejects.toThrow(
      "element not found: #gone",
    );
  });
});

describe("selectOption", () => {
  it("resolves ok when an option matches", async () => {
    stubChrome(() => evalOk("ok"));
    await expect(selectOption({ selector: "select", value: "IN", tabId: 1 })).resolves.toEqual({
      ok: true,
    });
  });

  it.each([
    ["missing", "element not found"],
    ["notselect", "not a <select> element"],
    ["nooption", "no option matching IN"],
  ])("maps outcome %s to a clear error", async (outcome, message) => {
    stubChrome(() => evalOk(outcome));
    await expect(selectOption({ selector: "select", value: "IN", tabId: 1 })).rejects.toThrow(
      message,
    );
  });
});

describe("upload", () => {
  it("resolves the node and sets the file inputs", async () => {
    const calls = stubChrome((method) => {
      if (method === "DOM.getDocument") return { root: { nodeId: 1 } };
      if (method === "DOM.querySelector") return { nodeId: 42 };
      return {};
    });
    await upload({ selector: "input[type=file]", files: ["/tmp/cv.pdf"], tabId: 1 });
    const set = calls.find((c) => c.method === "DOM.setFileInputFiles");
    expect(set?.params).toEqual({ files: ["/tmp/cv.pdf"], nodeId: 42 });
  });

  it("errors when the selector matches nothing", async () => {
    stubChrome((method) => {
      if (method === "DOM.getDocument") return { root: { nodeId: 1 } };
      if (method === "DOM.querySelector") return { nodeId: 0 };
      return {};
    });
    await expect(upload({ selector: "#gone", files: ["/tmp/a"], tabId: 1 })).rejects.toThrow(
      "element not found: #gone",
    );
  });
});

describe("readText", () => {
  it("reads document.body.innerText without a target", async () => {
    const calls = stubChrome(() => evalOk("hello world"));
    const r = await readText({ tabId: 1 });
    expect(r).toEqual({ text: "hello world" });
    expect(calls[0]?.params?.expression).toContain("document.body");
  });

  it("truncates to maxChars", async () => {
    stubChrome(() => evalOk("hello world"));
    expect((await readText({ tabId: 1, maxChars: 5 })).text).toBe("hello");
  });

  it("errors when a targeted element is missing", async () => {
    stubChrome(() => evalOk(null));
    await expect(readText({ selector: "#gone", tabId: 1 })).rejects.toThrow(
      "element not found: #gone",
    );
  });
});

describe("handleDialog", () => {
  it("enables Page and answers the dialog", async () => {
    const calls = stubChrome(() => ({}));
    await handleDialog({ accept: true, promptText: "yes", tabId: 1 });
    expect(calls.map((c) => c.method)).toEqual(["Page.enable", "Page.handleJavaScriptDialog"]);
    expect(calls[1]?.params).toEqual({ accept: true, promptText: "yes" });
  });

  it("maps the no-dialog CDP error to a friendly message", async () => {
    stubChrome((method) => {
      if (method === "Page.handleJavaScriptDialog") throw new Error("No dialog is showing");
      return {};
    });
    await expect(handleDialog({ accept: false, tabId: 1 })).rejects.toThrow(
      "no JavaScript dialog is open on this tab",
    );
  });
});

describe("cdpRaw", () => {
  it("forwards method and params verbatim and wraps the result", async () => {
    const calls = stubChrome(() => ({ frameId: "F1" }));
    const r = await cdpRaw({ method: "Page.navigate", params: { url: "https://x" }, tabId: 1 });
    expect(calls[0]).toEqual({ method: "Page.navigate", params: { url: "https://x" } });
    expect(r).toEqual({ result: { frameId: "F1" } });
  });

  it("normalizes undefined results to null", async () => {
    stubChrome(() => undefined);
    expect(await cdpRaw({ method: "Network.enable", tabId: 1 })).toEqual({ result: null });
  });
});

describe("resizeWindow", () => {
  it("resizes the window that owns the tab", async () => {
    stubChrome(() => ({}));
    await resizeWindow({ width: 1280, height: 800, tabId: 5 });
    const update = (chrome.windows.update as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(update).toEqual([99, { width: 1280, height: 800 }]);
  });

  it("falls back to the active tab when tabId is omitted", async () => {
    stubChrome(() => ({}));
    await resizeWindow({ width: 800, height: 600 });
    expect((chrome.windows.update as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });
});
