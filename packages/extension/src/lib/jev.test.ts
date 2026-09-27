import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./monitor.js", () => ({ isMonitored: () => false }));

import { initDebugSessionListeners } from "./cdp.js";
import { initDialogTracking, jevAct, jevObserve, OBSERVE_LOAD_MS, openDialog } from "./jev.js";

afterEach(() => vi.unstubAllGlobals());

function stubChrome(tab?: { url?: string; title?: string; status?: string }) {
  let onEvent: ((s: { tabId?: number }, m: string, p?: unknown) => void) | undefined;
  const sendCommand = vi.fn();
  const created: Array<(t: chrome.tabs.Tab) => void> = [];
  const updated: Array<[number, unknown]> = [];
  const detached: Array<(s: { tabId?: number }) => void> = [];
  vi.stubGlobal("chrome", {
    tabs: {
      get: vi.fn(async () => {
        if (!tab) throw new Error("No tab with id");
        return tab;
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
});
