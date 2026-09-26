import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./monitor.js", () => ({ isMonitored: () => false }));

import { initDialogTracking, jevAct, jevObserve, openDialog } from "./jev.js";

afterEach(() => vi.unstubAllGlobals());

function stubChrome() {
  let onEvent: ((s: { tabId?: number }, m: string, p?: unknown) => void) | undefined;
  const sendCommand = vi.fn();
  vi.stubGlobal("chrome", {
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
    const { fire, sendCommand } = stubChrome();
    fire(9, "Page.javascriptDialogOpening", { type: "alert", message: "Hi" });
    const obs = await jevObserve({ tabId: 9 });
    expect(obs.dialog).toEqual({ type: "alert", message: "Hi" });
    expect(sendCommand).not.toHaveBeenCalled();
  });
});

/** Answer the page-side scripts jevAct runs up to (and including) the press. */
function pageAnswers(opts: { onPoint?: () => Promise<unknown>; onPress?: () => Promise<unknown> }) {
  return async (_t: unknown, method: string, params?: { expression?: string; type?: string }) => {
    if (method === "Runtime.evaluate") {
      const expr = params?.expression ?? "";
      if (expr.includes("visibilityState")) return { result: { value: "visible" } };
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
});
