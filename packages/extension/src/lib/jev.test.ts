import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./monitor.js", () => ({ isMonitored: () => false }));

import { initDialogTracking, jevAct, jevObserve, openDialog } from "./jev.js";

afterEach(() => vi.unstubAllGlobals());

function stubChrome(tab?: { url?: string; title?: string }) {
  let onEvent: ((s: { tabId?: number }, m: string, p?: unknown) => void) | undefined;
  const sendCommand = vi.fn();
  vi.stubGlobal("chrome", {
    tabs: {
      get: vi.fn(async () => {
        if (!tab) throw new Error("No tab with id");
        return tab;
      }),
    },
    debugger: {
      attach: vi.fn(),
      detach: vi.fn(),
      sendCommand,
      onDetach: { addListener: () => {} },
      onEvent: { addListener: (fn: typeof onEvent) => (onEvent = fn) },
    },
  });
  initDialogTracking();
  return {
    fire: (tabId: number, m: string, p?: unknown) => onEvent?.({ tabId }, m, p),
    sendCommand,
  };
}

describe("dialog tracking", () => {
  it("remembers an open dialog until it closes", () => {
    const { fire } = stubChrome();
    fire(4, "Page.javascriptDialogOpening", { type: "confirm", message: "Leave?" });
    expect(openDialog(4)).toEqual({ type: "confirm", message: "Leave?" });
    fire(4, "Page.javascriptDialogClosed", {});
    expect(openDialog(4)).toBeUndefined();
  });

  it("observe reports the dialog without touching the blocked page", async () => {
    const { fire, sendCommand } = stubChrome({ url: "https://x.com/a", title: "X" });
    fire(9, "Page.javascriptDialogOpening", { type: "alert", message: "Hi" });
    const obs = await jevObserve({ tabId: 9 });
    expect(obs).toEqual({
      url: "https://x.com/a",
      title: "X",
      text: "",
      visible: true,
      actions: [],
      dialog: { type: "alert", message: "Hi" },
    });
    // The url and title come from the tabs API, never from CDP (blocked).
    expect(sendCommand).not.toHaveBeenCalled();
  });

  it("observe under a dialog still answers when the tab can't be looked up", async () => {
    const { fire } = stubChrome();
    fire(9, "Page.javascriptDialogOpening", { type: "alert", message: "Hi" });
    const obs = await jevObserve({ tabId: 9 });
    expect(obs).toMatchObject({ url: "", title: "", dialog: { type: "alert", message: "Hi" } });
  });
});

/** Answer the page-side scripts jevAct runs up to (and including) the press. */
function pageAnswers(opts: { onPoint?: () => Promise<unknown>; onPress?: () => Promise<unknown> }) {
  return async (_t: unknown, method: string, params?: { expression?: string; type?: string }) => {
    if (method === "Runtime.evaluate") {
      const expr = params?.expression ?? "";
      // ensureVisible's probe, exactly: actionPoint reads visibilityState too.
      if (expr === "document.visibilityState") return { result: { value: "visible" } };
      if (expr.includes("function jevCheck")) return { result: { value: "ok" } };
      if (expr.includes("function actionPoint")) {
        return opts.onPoint ? opts.onPoint() : { result: { value: { x: 5, y: 5 } } };
      }
      return { result: { value: undefined } };
    }
    if (method === "Input.dispatchMouseEvent" && params?.type === "mousePressed" && opts.onPress) {
      return opts.onPress();
    }
    return {};
  };
}

describe("jevAct", () => {
  it("rethrows a transport failure instead of calling the element stale", async () => {
    const { sendCommand } = stubChrome();
    sendCommand.mockImplementation(
      pageAnswers({ onPoint: async () => Promise.reject(new Error("Debugger is not attached")) }),
    );
    await expect(jevAct({ tabId: 3, op: "click", node: 1 })).rejects.toThrow(
      "Debugger is not attached",
    );
  });

  it("maps only actionability refusals to stale", async () => {
    const { sendCommand } = stubChrome();
    sendCommand.mockImplementation(
      pageAnswers({ onPoint: async () => ({ result: { value: { error: "covered by div#x" } } }) }),
    );
    await expect(jevAct({ tabId: 3, op: "click", node: 1 })).resolves.toMatchObject({
      stale: true,
      reason: expect.stringMatching(/^cannot click .*covered by div#x/),
    });
  });

  it("returns ok when the press opens a dialog and the page stops answering", async () => {
    const { fire, sendCommand } = stubChrome();
    sendCommand.mockImplementation(
      pageAnswers({
        onPress: () => {
          // The handler's confirm() freezes the renderer: this never resolves.
          setTimeout(
            () => fire(3, "Page.javascriptDialogOpening", { type: "confirm", message: "?" }),
            10,
          );
          return new Promise(() => {});
        },
      }),
    );
    await expect(jevAct({ tabId: 3, op: "click", node: 1 })).resolves.toEqual({ ok: true });
    expect(openDialog(3)).toEqual({ type: "confirm", message: "?" });
  });

  it("a dialog from elsewhere before the press is stale, not ok", async () => {
    const { fire, sendCommand } = stubChrome();
    sendCommand.mockImplementation(
      pageAnswers({
        onPoint: () => {
          // A page timer opens a dialog while we're still hit-testing.
          setTimeout(
            () => fire(3, "Page.javascriptDialogOpening", { type: "alert", message: "!" }),
            10,
          );
          return new Promise(() => {});
        },
      }),
    );
    await expect(jevAct({ tabId: 3, op: "click", node: 1 })).resolves.toEqual({
      stale: true,
      reason: "a dialog opened before the action",
    });
    const sent = sendCommand.mock.calls.map((c) => c[1]);
    expect(sent).not.toContain("Input.dispatchMouseEvent");
  });

  it("an abandoned type sends no more input once the press resumes", async () => {
    const { fire, sendCommand } = stubChrome();
    let releasePress!: (v: unknown) => void;
    sendCommand.mockImplementation(
      pageAnswers({
        onPress: () => {
          setTimeout(
            () => fire(3, "Page.javascriptDialogOpening", { type: "confirm", message: "?" }),
            10,
          );
          return new Promise((r) => {
            releasePress = r;
          });
        },
      }),
    );
    await expect(jevAct({ tabId: 3, op: "type", node: 1, text: "hi" })).resolves.toEqual({
      ok: true,
    });
    // The dialog is answered: the frozen press response arrives and the orphan resumes.
    releasePress({});
    await new Promise((r) => setTimeout(r, 20));
    const sent = sendCommand.mock.calls.map((c) => c[1]);
    expect(sent).not.toContain("Input.insertText");
    expect(sent).not.toContain("Input.dispatchKeyEvent");
  });
});
