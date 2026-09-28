import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./monitor.js", () => ({ isMonitored: () => false }));

import { __resetDebugSessions, initDebugSessionListeners } from "./cdp.js";
import {
  initDialogTracking,
  jevAct,
  jevObserve,
  NETWORK_IDLE_MS,
  OBSERVE_LOAD_MS,
  openDialog,
  PER_KEY_MAX_CHARS,
} from "./jev.js";

afterEach(() => vi.unstubAllGlobals());

function stubChrome(tab?: { url?: string; title?: string; status?: string }) {
  let onEvent: ((s: { tabId?: number }, m: string, p?: unknown) => void) | undefined;
  const sendCommand = vi.fn();
  const created: Array<(t: chrome.tabs.Tab) => void> = [];
  const updated: Array<[number, unknown]> = [];
  const opened: unknown[] = [];
  const detached: Array<(s: { tabId?: number }) => void> = [];
  vi.stubGlobal("chrome", {
    tabs: {
      get: vi.fn(async () => {
        if (!tab) throw new Error("No tab with id");
        return tab;
      }),
      create: vi.fn(async (props: unknown) => {
        opened.push(props);
        return { id: 9 };
      }),
      update: vi.fn(async (id: number, props: unknown) => {
        updated.push([id, props]);
        return {};
      }),
      onCreated: {
        addListener: (fn: (t: chrome.tabs.Tab) => void) => created.push(fn),
        removeListener: (fn: (t: chrome.tabs.Tab) => void) =>
          created.splice(created.indexOf(fn), 1),
      },
    },
    debugger: {
      attach: vi.fn(),
      detach: vi.fn(),
      sendCommand,
      onDetach: { addListener: (fn: (s: { tabId?: number }) => void) => detached.push(fn) },
      onEvent: { addListener: (fn: typeof onEvent) => (onEvent = fn) },
    },
  });
  initDialogTracking();
  return {
    fire: (tabId: number, m: string, p?: unknown) => onEvent?.({ tabId }, m, p),
    /** Chrome dropped the debugger session on this tab. */
    detach: (tabId: number) => {
      for (const fn of detached) fn({ tabId });
    },
    tabCreated: (t: { id: number; openerTabId: number }) => {
      for (const fn of created) fn(t as chrome.tabs.Tab);
    },
    created,
    updated,
    opened,
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

describe("jevObserve", () => {
  const SNAP = { url: "https://x.com/b", title: "B", text: "hi", visible: true, actions: [] };
  /** Answer observe's page reads: the document state, then the snapshot. */
  function docAnswers(state: () => { ready: string; body: boolean }, snapshot: () => unknown) {
    return async (_t: unknown, method: string, params?: { expression?: string }) => {
      if (method !== "Runtime.evaluate") return {};
      const expr = params?.expression ?? "";
      if (expr.includes("document.readyState")) return { result: { value: state() } };
      if (expr.includes("function jevSnapshot")) return snapshot();
      return { result: { value: undefined } };
    };
  }

  it("waits while the tab is loading, then reads the settled document", async () => {
    const tab = { url: "https://x.com/b", title: "B", status: "loading" };
    const { sendCommand } = stubChrome(tab);
    let reads = 0;
    sendCommand.mockImplementation(
      docAnswers(
        () => ({ ready: "complete", body: true }), // the old document, until the commit
        () => {
          reads += 1;
          return { result: { value: SNAP } };
        },
      ),
    );
    setTimeout(() => {
      tab.status = "complete";
    }, 250);
    const t0 = Date.now();
    expect(await jevObserve({ tabId: 3 })).toEqual(SNAP);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(200);
    expect(reads).toBe(1); // never read the page before it settled
  });

  it("reads a parsed new document at once, even while its subresources still load", async () => {
    const { sendCommand } = stubChrome({ url: "https://x.com/b", title: "B", status: "loading" });
    sendCommand.mockImplementation(
      docAnswers(
        () => ({ ready: "interactive", body: true }),
        () => ({ result: { value: SNAP } }),
      ),
    );
    const t0 = Date.now();
    expect(await jevObserve({ tabId: 3 })).toEqual(SNAP);
    expect(Date.now() - t0).toBeLessThan(150);
  });

  it("reads a settled page again once its in-flight data requests have landed", async () => {
    const { sendCommand, fire } = stubChrome({
      url: "https://x.com/b",
      title: "B",
      status: "complete",
    });
    let reads = 0;
    sendCommand.mockImplementation(
      docAnswers(
        () => ({ ready: "complete", body: true }),
        () => {
          reads += 1;
          return { result: { value: { ...SNAP, text: reads === 1 ? "Loading…" : "3 results" } } };
        },
      ),
    );
    fire(3, "Network.requestWillBeSent", { requestId: "r1", type: "XHR" });
    fire(3, "Network.requestWillBeSent", { requestId: "r2", type: "Image" }); // not data
    setTimeout(() => fire(3, "Network.loadingFinished", { requestId: "r1" }), 250);
    const t0 = Date.now();
    expect(await jevObserve({ tabId: 3 })).toMatchObject({ text: "3 results" });
    expect(Date.now() - t0).toBeGreaterThanOrEqual(250);
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(sendCommand).toHaveBeenCalledWith({ tabId: 3 }, "Network.enable", {});
  });

  it("gives up waiting for a data request after NETWORK_IDLE_MS and reads the page as it is", async () => {
    const { sendCommand, fire } = stubChrome({
      url: "https://x.com/b",
      title: "B",
      status: "complete",
    });
    sendCommand.mockImplementation(
      docAnswers(
        () => ({ ready: "complete", body: true }),
        () => ({ result: { value: SNAP } }),
      ),
    );
    fire(4, "Network.requestWillBeSent", { requestId: "slow", type: "Fetch" });
    const t0 = Date.now();
    expect(await jevObserve({ tabId: 4 })).toEqual(SNAP);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(NETWORK_IDLE_MS - 50);
    expect(Date.now() - t0).toBeLessThan(NETWORK_IDLE_MS + 600);
    fire(4, "Network.loadingFailed", { requestId: "slow" }); // tidy the per-tab set
  });

  it("re-attaches when the debugger session drops mid-observe", async () => {
    const { sendCommand, detach } = stubChrome({
      url: "https://x.com/b",
      title: "B",
      status: "complete",
    });
    initDebugSessionListeners();
    let polls = 0;
    sendCommand.mockImplementation(
      docAnswers(
        () => {
          polls += 1;
          if (polls === 1) {
            // A password manager's frame appeared: Chrome dropped the session.
            detach(7);
            throw new Error("Debugger is not attached to the tab with id: 7.");
          }
          return { ready: "complete", body: true };
        },
        () => ({ result: { value: SNAP } }),
      ),
    );
    expect(await jevObserve({ tabId: 7 })).toEqual(SNAP);
    expect(polls).toBe(2);
    const attaches = (chrome.debugger.attach as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([target]) => (target as { tabId: number }).tabId === 7,
    );
    expect(attaches).toHaveLength(2);
  });

  it("reports the last failure when the page never became readable", async () => {
    vi.useFakeTimers();
    try {
      const { sendCommand } = stubChrome({
        url: "https://x.com/b",
        title: "B",
        status: "complete",
      });
      sendCommand.mockImplementation(
        docAnswers(
          () => {
            throw new Error("Cannot access a chrome-extension:// URL of different extension");
          },
          () => ({ result: { value: SNAP } }),
        ),
      );
      const failed = jevObserve({ tabId: 8 }).then(
        () => "resolved",
        (e: Error) => e.message,
      );
      await vi.advanceTimersByTimeAsync(OBSERVE_LOAD_MS + 200);
      expect(await failed).toBe(
        "the page could not be read: Cannot access a chrome-extension:// URL of different extension",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("surfaces a page script failure instead of calling the page unloaded", async () => {
    const { sendCommand } = stubChrome({ url: "https://x.com/b", title: "B", status: "complete" });
    sendCommand.mockImplementation(
      docAnswers(
        () => ({ ready: "complete", body: true }),
        () => ({ result: {}, exceptionDetails: { text: "Uncaught TypeError: boom" } }),
      ),
    );
    await expect(jevObserve({ tabId: 3 })).rejects.toThrow(
      "page script failed: Uncaught TypeError: boom",
    );
  });

  it("gives up after the bound when no document ever appears", async () => {
    vi.useFakeTimers();
    try {
      const { sendCommand } = stubChrome({ url: "about:blank", title: "", status: "loading" });
      sendCommand.mockImplementation(
        docAnswers(
          () => ({ ready: "loading", body: false }),
          () => ({ result: { value: null } }),
        ),
      );
      const p = jevObserve({ tabId: 3 });
      const failed = p.then(
        () => "resolved",
        (e: Error) => e.message,
      );
      await vi.advanceTimersByTimeAsync(OBSERVE_LOAD_MS + 200);
      expect(await failed).toBe("the page did not finish loading");
    } finally {
      vi.useRealTimers();
    }
  });
});

/** Answer the page-side scripts jevAct runs up to (and including) the press. */
function pageAnswers(opts: {
  onPoint?: () => Promise<unknown>;
  onPress?: () => Promise<unknown>;
  /** The landed-check after the press (cdp.ts readProbe). */
  onProbe?: () => Promise<unknown>;
}) {
  return async (_t: unknown, method: string, params?: { expression?: string; type?: string }) => {
    if (method === "Runtime.evaluate") {
      const expr = params?.expression ?? "";
      // ensureVisible's probe, exactly: actionPoint reads visibilityState too.
      if (expr === "document.visibilityState") return { result: { value: "visible" } };
      if (expr.includes("function jevCheck")) return { result: { value: "ok" } };
      if (expr.includes("function actionPoint")) {
        return opts.onPoint ? opts.onPoint() : { result: { value: { x: 5, y: 5 } } };
      }
      if (expr.includes("function readProbe") && opts.onProbe) return opts.onProbe();
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

  it("a press that landed elsewhere is stale: the page moved, nothing intended happened", async () => {
    const { sendCommand } = stubChrome();
    sendCommand.mockImplementation(
      pageAnswers({
        onProbe: async () => ({ result: { value: { state: "missed", by: "form#search_form" } } }),
      }),
    );
    await expect(jevAct({ tabId: 3, op: "click", node: 1 })).resolves.toMatchObject({
      stale: true,
      reason: expect.stringMatching(/landed on form#search_form/),
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

  it("hands over a tab the click opened only once that tab has a loaded document", async () => {
    const { tabCreated, created, updated, sendCommand } = stubChrome();
    // What the new tab answers to each read: about:blank, then the committed
    // page still loading, then loaded.
    const pages = [
      { href: "about:blank", ready: "complete" },
      { href: "https://docs.x.com/", ready: "loading" },
      { href: "https://docs.x.com/", ready: "interactive" },
    ];
    const reads: string[] = [];
    const page = pageAnswers({
      onPress: async () => {
        tabCreated({ id: 9, openerTabId: 3 });
        return {};
      },
    });
    sendCommand.mockImplementation(
      async (target: { tabId: number }, method: string, params?: { expression?: string }) => {
        if (target.tabId === 9 && method === "Runtime.evaluate") {
          const p = pages.length > 1 ? (pages.shift() as (typeof pages)[number]) : pages[0];
          reads.push(`${p?.href} ${p?.ready}`);
          return { result: { value: p } };
        }
        return page(target, method, params);
      },
    );
    await expect(jevAct({ tabId: 3, op: "click", node: 1 })).resolves.toEqual({
      ok: true,
      openedTabId: 9,
    });
    expect(updated).toEqual([[9, { active: true }]]);
    expect(created).toEqual([]); // the watcher is gone
    expect(reads).toEqual([
      "about:blank complete",
      "https://docs.x.com/ loading",
      "https://docs.x.com/ interactive",
    ]);
  });

  it("opens the tab a new-tab link would have (next to the opener, active) and follows it", async () => {
    // The probe cancelled the link's own navigation, which would raise
    // Chrome's window over the user's app, and handed back its href.
    const { updated, opened, sendCommand } = stubChrome({ url: "https://x.com/" });
    (chrome.tabs.get as ReturnType<typeof vi.fn>).mockResolvedValue({ windowId: 1, index: 2 });
    const page = pageAnswers({
      onProbe: async () => ({
        result: { value: { state: "hit", newTabUrl: "https://docs.x.com/" } },
      }),
    });
    sendCommand.mockImplementation(
      async (target: { tabId: number }, method: string, params?: Record<string, unknown>) => {
        if (target.tabId === 9 && method === "Runtime.evaluate") {
          return { result: { value: { href: "https://docs.x.com/", ready: "complete" } } };
        }
        return page(target, method, params as { expression?: string; type?: string });
      },
    );
    await expect(jevAct({ tabId: 3, op: "click", node: 1 })).resolves.toEqual({
      ok: true,
      openedTabId: 9,
    });
    expect(opened).toEqual([
      { url: "https://docs.x.com/", windowId: 1, index: 3, openerTabId: 3, active: true },
    ]);
    expect(updated).toEqual([[9, { active: true }]]);
  });

  it("gives up waiting for a tab that never loads, and still hands it over", async () => {
    const { tabCreated, sendCommand } = stubChrome();
    const page = pageAnswers({
      onPress: async () => {
        tabCreated({ id: 9, openerTabId: 3 });
        return {};
      },
    });
    sendCommand.mockImplementation(
      async (target: { tabId: number }, method: string, params?: { expression?: string }) => {
        if (target.tabId === 9 && method === "Runtime.evaluate") {
          throw new Error("Execution context was destroyed."); // mid-commit, every time
        }
        return page(target, method, params);
      },
    );
    const t0 = Date.now();
    await expect(jevAct({ tabId: 3, op: "click", node: 1 })).resolves.toEqual({
      ok: true,
      openedTabId: 9,
    });
    const took = Date.now() - t0;
    expect(took).toBeGreaterThanOrEqual(2900);
    expect(took).toBeLessThan(4500);
  }, 10_000);

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

  it("types a value key by key: keyDown with its text, then keyUp, per character", async () => {
    const { sendCommand } = stubChrome();
    sendCommand.mockImplementation(pageAnswers({}));
    await expect(jevAct({ tabId: 3, op: "type", node: 1, text: "a1 ?" })).resolves.toEqual({
      ok: true,
    });
    const keys = sendCommand.mock.calls
      .filter((c) => c[1] === "Input.dispatchKeyEvent")
      .map((c) => c[2] as Record<string, unknown>)
      .filter((p) => p.commands === undefined && p.modifiers === undefined); // not the select-all
    expect(keys.map((p) => `${p.type}:${p.key}`)).toEqual([
      "keyDown:a",
      "keyUp:a",
      "keyDown:1",
      "keyUp:1",
      "keyDown: ",
      "keyUp: ",
      "keyDown:?",
      "keyUp:?",
    ]);
    // The keyDown carries the text (that is what generates keypress + input); keyUp does not.
    expect(keys[0]).toMatchObject({ text: "a", code: "KeyA", windowsVirtualKeyCode: 65 });
    expect(keys[1]).not.toHaveProperty("text");
    expect(keys[2]).toMatchObject({ text: "1", code: "Digit1", windowsVirtualKeyCode: 49 });
    expect(keys[6]).toMatchObject({ text: "?" });
    expect(keys[6]).not.toHaveProperty("code");
    expect(sendCommand.mock.calls.map((c) => c[1])).not.toContain("Input.insertText");
  });

  describe("a debugger session dropped mid-typing", () => {
    /** Keys sent so far, "keyDown:x" form, select-all excluded. */
    const typed = (sendCommand: ReturnType<typeof vi.fn>) =>
      sendCommand.mock.calls
        .filter((c) => c[1] === "Input.dispatchKeyEvent")
        .map((c) => c[2] as Record<string, unknown>)
        .filter((p) => p.commands === undefined && p.modifiers === undefined)
        .map((p) => `${p.type}:${p.key}`);

    /** The second character's keyDown dies with the session; the field then holds `landed`. */
    function dropping(landed: string) {
      const stub = stubChrome();
      __resetDebugSessions();
      initDebugSessionListeners();
      let downs = 0;
      let dropped = false;
      const base = pageAnswers({});
      stub.sendCommand.mockImplementation(
        async (t: unknown, method: string, params?: Record<string, unknown>) => {
          if (
            method === "Input.dispatchKeyEvent" &&
            params?.type === "keyDown" &&
            !params.commands
          ) {
            downs += 1;
            if (downs === 2 && !dropped) {
              dropped = true;
              stub.detach(3);
              throw new Error("Detached while handling command.");
            }
          }
          if (method === "Runtime.evaluate") {
            const expr = (params as { expression?: string })?.expression ?? "";
            if (expr.includes("function jevFieldValue")) return { result: { value: landed } };
          }
          return base(t, method, params as { expression?: string; type?: string });
        },
      );
      return stub;
    }

    it("drives the tab again and resumes after the character that landed", async () => {
      const { sendCommand } = dropping("ab");
      await expect(jevAct({ tabId: 3, op: "type", node: 1, text: "abc" })).resolves.toEqual({
        ok: true,
      });
      expect(typed(sendCommand)).toEqual([
        "keyDown:a",
        "keyUp:a",
        "keyDown:b", // died with the session, but landed
        "keyDown:c",
        "keyUp:c",
      ]);
      expect(chrome.debugger.attach).toHaveBeenCalledTimes(2);
    });

    it("retypes the character that did not land", async () => {
      const { sendCommand } = dropping("a");
      await jevAct({ tabId: 3, op: "type", node: 1, text: "abc" });
      expect(typed(sendCommand)).toEqual([
        "keyDown:a",
        "keyUp:a",
        "keyDown:b",
        "keyDown:b",
        "keyUp:b",
        "keyDown:c",
        "keyUp:c",
      ]);
    });

    it("starts over when the field holds something else", async () => {
      const { sendCommand } = dropping("A-");
      await jevAct({ tabId: 3, op: "type", node: 1, text: "abc" });
      expect(typed(sendCommand)).toEqual([
        "keyDown:a",
        "keyUp:a",
        "keyDown:b",
        "keyDown:a",
        "keyUp:a",
        "keyDown:b",
        "keyUp:b",
        "keyDown:c",
        "keyUp:c",
      ]);
      // Select-all ran twice: once before typing, once before starting over.
      const selectAlls = sendCommand.mock.calls.filter(
        (c) => c[1] === "Input.dispatchKeyEvent" && (c[2] as { commands?: unknown }).commands,
      );
      expect(selectAlls).toHaveLength(2);
    });

    it("any other send failure is still the act's error", async () => {
      const { sendCommand } = stubChrome();
      sendCommand.mockImplementation(
        async (t: unknown, method: string, params?: Record<string, unknown>) => {
          if (method === "Input.dispatchKeyEvent" && !params?.commands) throw new Error("No node");
          return pageAnswers({})(t, method, params as { expression?: string; type?: string });
        },
      );
      await expect(jevAct({ tabId: 3, op: "type", node: 1, text: "ab" })).rejects.toThrow(
        "No node",
      );
    });
  });

  it("inserts a long value whole instead of typing it key by key", async () => {
    const { sendCommand } = stubChrome();
    sendCommand.mockImplementation(pageAnswers({}));
    const text = "x".repeat(PER_KEY_MAX_CHARS + 1);
    await expect(jevAct({ tabId: 3, op: "type", node: 1, text })).resolves.toEqual({ ok: true });
    const sent = sendCommand.mock.calls.map((c) => c[1]);
    expect(sent).toContain("Input.insertText");
    // Only the select-all pair touched the key path.
    expect(sent.filter((m) => m === "Input.dispatchKeyEvent")).toHaveLength(2);
  });
});
