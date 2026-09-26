import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./monitor.js", () => ({ isMonitored: () => false }));

import {
  __resetDebugSessions,
  cdpClick,
  cdpOpenTab,
  cdpType,
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

  /** Swap in a recording sendCommand; returns the calls made through it. */
  function recordCommands(result: (method: string) => unknown = () => ({})) {
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    (chrome.debugger as unknown as { sendCommand: unknown }).sendCommand = vi.fn(
      async (_t: unknown, method: string, params: Record<string, unknown>) => {
        calls.push({ method, params });
        return result(method);
      },
    );
    return calls;
  }
  const guardEvals = (calls: Array<{ method: string; params: Record<string, unknown> }>) =>
    calls.filter(
      (c) =>
        c.method === "Runtime.evaluate" && String(c.params.expression).includes("autofillGuard"),
    );

  it("arms the autofill guard for commands that drive the page", async () => {
    stubChrome();
    const calls = recordCommands();
    await withDebugger(7, async () => "a", { guard: true });
    await withDebugger(7, async () => "b", { guard: true });
    expect(guardEvals(calls)).toHaveLength(2);
  });

  it("leaves the page untouched for everything else (reads, dialogs, eval)", async () => {
    // Read-tier commands must not mutate the page, and a command that has to
    // work under a JS dialog can't wait on an evaluate the dialog blocks.
    stubChrome();
    const calls = recordCommands();
    await withDebugger(7, async () => "read");
    expect(calls).toEqual([]);
  });

  it("re-registers the new-document guard with an absolute expiry on every renewal", async () => {
    // A static script would re-arm a fresh 30s lease on every page load for
    // the life of the session — hiding the user's password manager long after
    // reins went idle (the monitor keeps its session for the tab's lifetime).
    stubChrome();
    let id = 0;
    const calls = recordCommands((m) =>
      m === "Page.addScriptToEvaluateOnNewDocument" ? { identifier: String(++id) } : {},
    );
    await withDebugger(7, async () => "a", { guard: true });
    await withDebugger(7, async () => "b", { guard: true });
    const adds = calls.filter((c) => c.method === "Page.addScriptToEvaluateOnNewDocument");
    const removes = calls.filter((c) => c.method === "Page.removeScriptToEvaluateOnNewDocument");
    expect(adds).toHaveLength(2);
    expect(removes.map((c) => c.params.identifier)).toEqual(["1"]);
    expect(calls.filter((c) => c.method === "Page.enable")).toHaveLength(1);
    expect(String(adds[1]?.params.source)).toMatch(/\(\d{13} - Date\.now\(\)\)/);
  });

  it("starts over with a fresh debugger session", async () => {
    stubChrome();
    const calls = recordCommands((m) =>
      m === "Page.addScriptToEvaluateOnNewDocument" ? { identifier: "x" } : {},
    );
    await withDebugger(7, async () => "a", { guard: true });
    await vi.advanceTimersByTimeAsync(4000); // idle detach ends the session
    await withDebugger(7, async () => "c", { guard: true });
    expect(calls.filter((c) => c.method === "Page.enable")).toHaveLength(2);
    // The old session's script died with it — nothing to remove.
    expect(calls.filter((c) => c.method === "Page.removeScriptToEvaluateOnNewDocument")).toEqual(
      [],
    );
  });

  it("still runs the command when arming the guard fails", async () => {
    stubChrome();
    (chrome.debugger as unknown as { sendCommand: () => Promise<never> }).sendCommand =
      async () => {
        throw new Error("Execution context was destroyed.");
      };
    expect(await withDebugger(7, async () => "ran", { guard: true })).toBe("ran");
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

  it("treats a press nobody saw as delivered — failing it would click twice", async () => {
    // A page listener that stops propagation first hides the press from the
    // probe; the click still landed.
    const { events } = stubClickChrome({ probe: { state: "none" } });
    await expect(
      cdpClick({ tabId: 7, selector: "#buy", button: "left", clickCount: 1 }),
    ).resolves.toEqual({ ok: true });
    expect(events).toHaveLength(3);
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

  it("doesn't navigate a second time when the page itself fails to load", async () => {
    // A network error or a download already shows in the tab; repeating the
    // navigation would start the download twice.
    const { update } = stubOpenChrome({ id: 42 });
    (chrome.debugger as unknown as { sendCommand: unknown }).sendCommand = async (
      _t: unknown,
      method: string,
    ) => (method === "Page.navigate" ? { errorText: "net::ERR_ABORTED" } : {});
    await cdpOpenTab({ url: "https://example.com/file.zip", activate: true });
    expect(update).not.toHaveBeenCalled();
  });

  it("returns tabId -1 when the created tab has no id", async () => {
    stubOpenChrome({});
    expect(await cdpOpenTab({ url: "https://x", activate: false })).toEqual({ tabId: -1 });
  });
});

describe("cdpType", () => {
  it("brings a background tab to the front before typing", async () => {
    const visible = [false, true];
    const update = vi.fn(async () => ({}));
    const methods: string[] = [];
    vi.stubGlobal("chrome", {
      debugger: {
        attach: vi.fn(async () => {}),
        detach: vi.fn(async () => {}),
        onDetach: { addListener: () => {} },
        sendCommand: vi.fn(async (_t: unknown, method: string, params: { expression?: string }) => {
          methods.push(method);
          if (method !== "Runtime.evaluate") return {};
          if (String(params.expression).includes("visibilityState")) {
            return {
              result: {
                value: (visible.length > 1 ? visible.shift() : visible[0]) ? "visible" : "hidden",
              },
            };
          }
          return { result: { value: true } };
        }),
      },
      tabs: { update },
    });
    initDebugSessionListeners();
    const done = cdpType({ tabId: 7, selector: "#q", text: "hi", submit: false });
    await vi.advanceTimersByTimeAsync(500);
    await done;
    expect(update).toHaveBeenCalledWith(7, { active: true });
    expect(methods).toContain("Input.insertText");
  });
});
