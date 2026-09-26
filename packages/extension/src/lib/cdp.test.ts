import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./monitor.js", () => ({ isMonitored: () => false }));

import {
  __resetDebugSessions,
  cdpClick,
  cdpOpenTab,
  initDebugSessionListeners,
  withDebugger,
} from "./cdp.js";

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

  it("arms the autofill guard in the page on every command", async () => {
    stubChrome();
    const sendCommand = vi.fn(async () => ({}));
    (chrome.debugger as unknown as { sendCommand: typeof sendCommand }).sendCommand = sendCommand;
    await withDebugger(7, async () => "a");
    await withDebugger(7, async () => "b");
    const arms = sendCommand.mock.calls.filter(
      (c) =>
        (c as unknown[])[1] === "Runtime.evaluate" &&
        String(((c as unknown[])[2] as { expression: string }).expression).includes(
          "autofillGuard",
        ),
    );
    expect(arms).toHaveLength(2);
  });

  it("injects the guard into new documents once per debugger session", async () => {
    // A navigation (e.g. clicking "Login") loads a fresh document with no
    // guard; a login page that autofocuses its field opens the autofill menu
    // before the next command could re-arm it.
    stubChrome();
    const sendCommand = vi.fn(async () => ({}));
    (chrome.debugger as unknown as { sendCommand: typeof sendCommand }).sendCommand = sendCommand;
    const registrations = () =>
      sendCommand.mock.calls.filter(
        (c) => (c as unknown[])[1] === "Page.addScriptToEvaluateOnNewDocument",
      );
    await withDebugger(7, async () => "a");
    await withDebugger(7, async () => "b");
    expect(registrations()).toHaveLength(1);
    expect(
      String(
        (registrations()[0] as unknown[])[2] &&
          ((registrations()[0] as unknown[])[2] as { source: string }).source,
      ),
    ).toContain("autofillGuard");
    await vi.advanceTimersByTimeAsync(4000); // idle detach ends the session
    await withDebugger(7, async () => "c");
    expect(registrations()).toHaveLength(2);
  });

  it("still runs the command when arming the guard fails", async () => {
    stubChrome();
    (chrome.debugger as unknown as { sendCommand: () => Promise<never> }).sendCommand =
      async () => {
        throw new Error("Execution context was destroyed.");
      };
    expect(await withDebugger(7, async () => "ran")).toBe("ran");
  });

  it("names the password manager when another extension's frame blocks the tab", async () => {
    stubChrome(99);
    (chrome.debugger as unknown as { getTargets: () => Promise<unknown[]> }).getTargets =
      async () => [{ tabId: 42, attached: false, url: "https://calendly.com/x" }];
    const p = withDebugger(42, async () => "never").catch((e) => e as Error);
    await vi.advanceTimersByTimeAsync(2000);
    const err = (await p) as Error;
    expect(err.message).toContain("tab 42");
    expect(err.message).toMatch(/password manager/);
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
  /** chrome stub with a scripted page; records mouse events. */
  function stubClickChrome(
    opts: { visible?: boolean[]; point?: unknown; probe?: unknown; probeThrows?: boolean } = {},
  ) {
    const events: Array<Record<string, unknown>> = [];
    const visible = [...(opts.visible ?? [true])];
    const update = vi.fn(async () => ({}));
    vi.stubGlobal("chrome", {
      debugger: {
        attach: vi.fn(async () => {}),
        detach: vi.fn(async () => {}),
        onDetach: { addListener: () => {} },
        sendCommand: vi.fn(async (_t: unknown, method: string, params: Record<string, unknown>) => {
          if (method === "Input.dispatchMouseEvent") events.push(params);
          if (method !== "Runtime.evaluate") return {};
          const expr = String(params.expression);
          if (expr.includes("visibilityState")) {
            const v = visible.length > 1 ? visible.shift() : visible[0];
            return { result: { value: v ? "visible" : "hidden" } };
          }
          if (expr.includes("actionPoint")) {
            return { result: { value: opts.point ?? { x: 10, y: 20 } } };
          }
          if (expr.includes("readProbe")) {
            if (opts.probeThrows) throw new Error("Execution context was destroyed.");
            return { result: { value: opts.probe === undefined ? { state: "hit" } : opts.probe } };
          }
          return { result: { value: null } };
        }),
      },
      tabs: { update },
    });
    initDebugSessionListeners();
    return { events, update };
  }

  it("moves, presses with the left-button bitmask, then releases", async () => {
    const { events } = stubClickChrome();
    await cdpClick({ tabId: 7, ref: "e1", button: "left", clickCount: 1 });
    expect(events.map((e) => e.type)).toEqual(["mouseMoved", "mousePressed", "mouseReleased"]);
    expect(events[1]).toMatchObject({ button: "left", buttons: 1, clickCount: 1, x: 10, y: 20 });
    expect(events[2]).toMatchObject({ buttons: 0 });
  });

  it("defaults to a single left click when the CLI omits button and count", async () => {
    // `reins click --ref e1` sends neither; nothing applies the schema defaults
    // on the way in. CDP's own defaults (button "none", clickCount 0) move the
    // pointer but never press — the click silently does nothing.
    const { events } = stubClickChrome();
    await cdpClick({ tabId: 7, ref: "e1" } as Parameters<typeof cdpClick>[0]);
    expect(events[1]).toMatchObject({
      type: "mousePressed",
      button: "left",
      buttons: 1,
      clickCount: 1,
    });
    expect(events[2]).toMatchObject({ type: "mouseReleased", button: "left", clickCount: 1 });
  });

  it("uses the right-button bitmask for a right click", async () => {
    const { events } = stubClickChrome();
    await cdpClick({ tabId: 7, ref: "e1", button: "right", clickCount: 1 });
    expect(events[1]).toMatchObject({ button: "right", buttons: 2 });
  });

  it("throws when the element is not found", async () => {
    stubClickChrome({ point: { error: "notfound" } });
    await expect(
      cdpClick({ tabId: 7, selector: "#gone", button: "left", clickCount: 1 }),
    ).rejects.toThrow("element not found: #gone");
  });

  it("refuses to click blind when the element isn't actionable", async () => {
    const { events } = stubClickChrome({ point: { error: "covered by div#cookie-banner" } });
    await expect(
      cdpClick({ tabId: 7, selector: "#buy", button: "left", clickCount: 1 }),
    ).rejects.toThrow("cannot click #buy: covered by div#cookie-banner");
    expect(events).toHaveLength(0);
  });

  it("errors when the press landed on a different element", async () => {
    stubClickChrome({ probe: { state: "missed", by: "div.toast" } });
    await expect(
      cdpClick({ tabId: 7, selector: "#buy", button: "left", clickCount: 1 }),
    ).rejects.toThrow(/landed on div\.toast/);
  });

  it("errors when no pointer event reached the page at all", async () => {
    stubClickChrome({ probe: { state: "none" } });
    await expect(
      cdpClick({ tabId: 7, selector: "#buy", button: "left", clickCount: 1 }),
    ).rejects.toThrow(/never reached the page/);
  });

  it("treats a vanished probe as success — the click navigated away", async () => {
    stubClickChrome({ probe: null });
    await expect(
      cdpClick({ tabId: 7, selector: "#next", button: "left", clickCount: 1 }),
    ).resolves.toEqual({ ok: true });
    stubClickChrome({ probeThrows: true });
    await expect(
      cdpClick({ tabId: 8, selector: "#next", button: "left", clickCount: 1 }),
    ).resolves.toEqual({ ok: true });
  });

  it("brings a background tab to the front before clicking", async () => {
    const { events, update } = stubClickChrome({ visible: [false, true] });
    const done = cdpClick({ tabId: 7, ref: "e1", button: "left", clickCount: 1 });
    await vi.advanceTimersByTimeAsync(500);
    await done;
    expect(update).toHaveBeenCalledWith(7, { active: true });
    expect(events.map((e) => e.type)).toEqual(["mouseMoved", "mousePressed", "mouseReleased"]);
  });

  it("fails fast — without queueing input — when the tab stays hidden", async () => {
    // Chromium holds CDP input for hidden tabs and replays it whenever the tab
    // is next shown; a click must never be left queued like that.
    const { events } = stubClickChrome({ visible: [false] });
    const done = expect(
      cdpClick({ tabId: 7, ref: "e1", button: "left", clickCount: 1 }),
    ).rejects.toThrow(/tab 7 is not visible/);
    await vi.advanceTimersByTimeAsync(5000);
    await done;
    expect(events).toHaveLength(0);
  });
});

describe("cdpOpenTab", () => {
  function stubOpenChrome(opts: { id?: number; attachError?: string } = {}) {
    const order: string[] = [];
    const create = vi.fn(async (props: { url: string; active: boolean }) => {
      order.push(`create ${props.url}`);
      return { id: opts.id };
    });
    const update = vi.fn(async (_id: number, props: { url: string }) => {
      order.push(`update ${props.url}`);
      return {};
    });
    vi.stubGlobal("chrome", {
      debugger: {
        attach: vi.fn(async () => {
          if (opts.attachError) throw new Error(opts.attachError);
        }),
        detach: vi.fn(async () => {}),
        getTargets: async () => [],
        onDetach: { addListener: () => {} },
        sendCommand: vi.fn(async (_t: unknown, method: string, params: Record<string, unknown>) => {
          order.push(method === "Page.navigate" ? `navigate ${params.url}` : method);
          return {};
        }),
      },
      tabs: { create, update },
    });
    initDebugSessionListeners();
    return { order, create, update };
  }

  it("guards the tab before the page loads: blank tab, guard, then navigate", async () => {
    // Opening the URL directly lets a login page autofocus its field — and a
    // password manager open its menu — before reins could ever attach.
    const { order, create } = stubOpenChrome({ id: 42 });
    expect(await cdpOpenTab({ url: "https://example.com/login", activate: false })).toEqual({
      tabId: 42,
    });
    expect(create).toHaveBeenCalledWith({ url: "about:blank", active: false });
    const guard = order.indexOf("Page.addScriptToEvaluateOnNewDocument");
    expect(guard).toBeGreaterThan(0);
    expect(order.indexOf("navigate https://example.com/login")).toBeGreaterThan(guard);
  });

  it("falls back to a plain navigation when the debugger can't drive the tab", async () => {
    const { order, update } = stubOpenChrome({
      id: 42,
      attachError: "Debugging is not allowed here",
    });
    expect(await cdpOpenTab({ url: "https://example.com", activate: true })).toEqual({
      tabId: 42,
    });
    expect(update).toHaveBeenCalledWith(42, { url: "https://example.com" });
    expect(order.some((o) => o.startsWith("navigate"))).toBe(false);
  });

  it("returns tabId -1 when the created tab has no id", async () => {
    stubOpenChrome({});
    expect(await cdpOpenTab({ url: "https://x", activate: false })).toEqual({ tabId: -1 });
  });
});
