import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./monitor.js", () => ({ isMonitored: () => false }));

import { __resetDebugSessions, cdpClick, initDebugSessionListeners, withDebugger } from "./cdp.js";

let onDetach: ((source: { tabId?: number }) => void) | undefined;

/** chrome stub whose attach fails `failN` times before succeeding. */
function stubChrome(
  failN = 0,
  error = "Cannot access a chrome-extension:// URL of different extension",
) {
  const attach = vi.fn(async () => {
    if (attach.mock.calls.length <= failN) throw new Error(error);
  });
  const detach = vi.fn(async () => {});
  vi.stubGlobal("chrome", {
    debugger: {
      attach,
      detach,
      onDetach: { addListener: (fn: (s: { tabId?: number }) => void) => (onDetach = fn) },
    },
  });
  initDebugSessionListeners();
  return { attach, detach };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  __resetDebugSessions();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("withDebugger session", () => {
  it("attaches, runs, and detaches only after the idle window", async () => {
    const { attach, detach } = stubChrome();
    expect(await withDebugger(7, async () => "done")).toBe("done");
    expect(attach).toHaveBeenCalledTimes(1);
    expect(detach).not.toHaveBeenCalled(); // still warm
    await vi.advanceTimersByTimeAsync(4000);
    expect(detach).toHaveBeenCalledTimes(1);
  });

  it("reuses the warm session for back-to-back commands (one attach, one detach)", async () => {
    const { attach, detach } = stubChrome();
    await withDebugger(7, async () => "a");
    await withDebugger(7, async () => "b");
    await withDebugger(7, async () => "c");
    expect(attach).toHaveBeenCalledTimes(1);
    expect(detach).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(4000);
    expect(detach).toHaveBeenCalledTimes(1);
  });

  it("retries through the transient detach-in-flight attach error", async () => {
    const { attach } = stubChrome(3);
    const p = withDebugger(7, async () => "ok").catch((e) => e); // observe now
    await vi.advanceTimersByTimeAsync(1000); // let the backoff timers fire
    expect(await p).toBe("ok");
    expect(attach).toHaveBeenCalledTimes(4);
  });

  it("gives up after maxTries and names the tab in the error", async () => {
    stubChrome(99);
    const p = withDebugger(42, async () => "never").catch((e) => e as Error); // observe now
    await vi.advanceTimersByTimeAsync(2000);
    const err = await p;
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain("attach tab 42 failed");
  });

  it("re-attaches after an external detach purges the session", async () => {
    const { attach } = stubChrome();
    await withDebugger(7, async () => "a");
    expect(attach).toHaveBeenCalledTimes(1);
    onDetach?.({ tabId: 7 }); // tab closed / DevTools opened
    await withDebugger(7, async () => "b");
    expect(attach).toHaveBeenCalledTimes(2);
  });
});

describe("cdpClick", () => {
  /** chrome stub that resolves the element center and records mouse events. */
  function stubClickChrome(center: { x: number; y: number } | null = { x: 10, y: 20 }) {
    const events: Array<Record<string, unknown>> = [];
    vi.stubGlobal("chrome", {
      debugger: {
        attach: vi.fn(async () => {}),
        detach: vi.fn(async () => {}),
        onDetach: { addListener: () => {} },
        sendCommand: vi.fn(async (_t: unknown, method: string, params: Record<string, unknown>) => {
          if (method === "Runtime.evaluate") return { result: { value: center } };
          if (method === "Input.dispatchMouseEvent") events.push(params);
          return {};
        }),
      },
    });
    initDebugSessionListeners();
    return events;
  }

  it("moves, presses with the left-button bitmask, then releases", async () => {
    const events = stubClickChrome();
    await cdpClick({ tabId: 7, ref: "e1", button: "left", clickCount: 1 });
    expect(events.map((e) => e.type)).toEqual(["mouseMoved", "mousePressed", "mouseReleased"]);
    expect(events[1]).toMatchObject({ button: "left", buttons: 1, clickCount: 1, x: 10, y: 20 });
    expect(events[2]).toMatchObject({ buttons: 0 });
  });

  it("uses the right-button bitmask for a right click", async () => {
    const events = stubClickChrome();
    await cdpClick({ tabId: 7, ref: "e1", button: "right", clickCount: 1 });
    expect(events[1]).toMatchObject({ button: "right", buttons: 2 });
  });

  it("throws when the element is not found", async () => {
    stubClickChrome(null);
    await expect(
      cdpClick({ tabId: 7, selector: "#gone", button: "left", clickCount: 1 }),
    ).rejects.toThrow("element not found: #gone");
  });
});
