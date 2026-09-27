import type {
  JevActParams,
  JevActResult,
  JevDialog,
  JevObservation,
  JevObserveParams,
} from "@reins/protocol";
import {
  actionablePoint,
  drivePage,
  ensureVisible,
  openLinkTab,
  PRESS_MISSED,
  pressAt,
  resolveTabId,
  send,
} from "./cdp.js";
import {
  jevCheck,
  jevFieldValue,
  jevSelect,
  jevSettle,
  jevSnapshot,
  jevSubmitFocus,
  jevSubmitted,
} from "./jev-snapshot.js";

/** reins do waits this long for a covered or moving target, then re-reads the page. */
export const JEV_ACTION_TIMEOUT_MS = 500;

const DIALOGS = new Map<number, JevDialog>();
/** Per tab: XHR/fetch requests in flight, from the driven session's Network events. */
const PENDING = new Map<number, Set<string>>();
/** Request types that carry the data a page renders as results. */
const DATA_REQUESTS = new Set(["XHR", "Fetch"]);
/** How long observe waits, past a settled document, for in-flight data requests. */
export const NETWORK_IDLE_MS = 1500;
/** Acts in flight, waiting to hear that a dialog opened on their tab. */
const DIALOG_WAITERS = new Map<number, Set<(dialog: JevDialog) => void>>();

/**
 * Track JS dialogs per tab. An open alert/confirm/prompt blocks every
 * Runtime.evaluate, so observe must know about it *before* touching the page.
 * Page events flow on sessions armed by the autofill guard (drivePage).
 */
export function initDialogTracking(): void {
  chrome.debugger.onEvent.addListener((source, method, params) => {
    const tabId = source.tabId;
    if (tabId === undefined) return;
    if (method === "Page.javascriptDialogOpening") {
      const p = (params ?? {}) as { type?: string; message?: string };
      const dialog = { type: p.type ?? "dialog", message: p.message ?? "" };
      DIALOGS.set(tabId, dialog);
      for (const resolve of DIALOG_WAITERS.get(tabId) ?? []) resolve(dialog);
    } else if (method === "Page.javascriptDialogClosed") {
      DIALOGS.delete(tabId);
    } else if (method === "Network.requestWillBeSent") {
      const p = (params ?? {}) as { requestId?: string; type?: string };
      if (p.requestId !== undefined && DATA_REQUESTS.has(p.type ?? "")) {
        let set = PENDING.get(tabId);
        if (!set) {
          set = new Set();
          PENDING.set(tabId, set);
        }
        set.add(p.requestId);
      }
    } else if (method === "Network.loadingFinished" || method === "Network.loadingFailed") {
      const p = (params ?? {}) as { requestId?: string };
      if (p.requestId !== undefined) PENDING.get(tabId)?.delete(p.requestId);
    }
  });
  chrome.debugger.onDetach.addListener((source) => {
    if (source.tabId !== undefined) {
      DIALOGS.delete(source.tabId);
      PENDING.delete(source.tabId);
    }
  });
}

try {
  initDialogTracking();
} catch {
  // `chrome` not available yet (unit tests stub it per case).
}

export function openDialog(tabId: number): JevDialog | undefined {
  return DIALOGS.get(tabId);
}

/** XHR/fetch requests the tab has in flight (as far as the driven session saw). */
export function pendingRequests(tabId: number): number {
  return PENDING.get(tabId)?.size ?? 0;
}

/** Have the session report the tab's requests (idempotent; best-effort). */
async function armNetwork(tabId: number): Promise<void> {
  await send(tabId, "Network.enable", {}).catch(() => {});
}

/** Resolves when a dialog opens on the tab; `cancel` drops the waiter. */
function dialogOpened(tabId: number): { promise: Promise<JevDialog>; cancel: () => void } {
  let resolve!: (dialog: JevDialog) => void;
  const promise = new Promise<JevDialog>((r) => {
    resolve = r;
  });
  let waiters = DIALOG_WAITERS.get(tabId);
  if (!waiters) {
    waiters = new Set();
    DIALOG_WAITERS.set(tabId, waiters);
  }
  waiters.add(resolve);
  return {
    promise,
    cancel: () => {
      waiters.delete(resolve);
      if (waiters.size === 0 && DIALOG_WAITERS.get(tabId) === waiters) DIALOG_WAITERS.delete(tabId);
    },
  };
}

/** Errors actionablePoint raises about the target itself; anything else is transport. */
const ACTIONABILITY_REFUSAL = /^(element not found|cannot )/;

async function evaluate<T>(tabId: number, expression: string, awaitPromise = false): Promise<T> {
  const res = await send<{ result: { value: T }; exceptionDetails?: { text?: string } }>(
    tabId,
    "Runtime.evaluate",
    { expression, returnByValue: true, awaitPromise },
  );
  if (res.exceptionDetails) {
    throw new Error(`page script failed: ${res.exceptionDetails.text ?? "exception"}`);
  }
  return res.result.value;
}

/** url/title/status from the tabs API (no CDP), or nothing when the lookup fails. */
async function tabInfo(
  tabId: number,
): Promise<{ url?: string; title?: string; status?: string } | undefined> {
  try {
    return await chrome.tabs.get(tabId);
  } catch {
    return undefined;
  }
}

/** How long observe waits for a navigating or loading document to settle. */
export const OBSERVE_LOAD_MS = 4000;

/** A page script threw (as opposed to the evaluate itself failing). */
const SCRIPT_FAILED = /^page script failed/;

type Snapshot = Omit<JevObservation, "dialog">;

/**
 * One attempt to read the page, on a tab that is already driven: nothing
 * when the document is not worth reading yet. After an action that
 * navigates, the tab is "loading" while the old document is still the one an
 * evaluate would see (the commit comes later), and the new one has no body
 * or is still parsing for a while after that. Past the bound (`overdue`),
 * whatever document has a body is read.
 */
async function readOnce(
  tabId: number,
  overdue: boolean,
  terms: string[],
): Promise<Snapshot | undefined> {
  const tab = await tabInfo(tabId);
  const doc = await evaluate<{ ready: string; body: boolean }>(
    tabId,
    "({ ready: document.readyState, body: !!document.body })",
  );
  if (!doc.body) return undefined;
  // Under a loading tab, "complete" is the old document (finished before the
  // click) and "loading" a new one still parsing; "interactive" can only be
  // the new document, parsed, so it is safe to read even while its
  // subresources still load.
  const settled = tab?.status !== "loading" || doc.ready === "interactive";
  if (!settled && !overdue) return undefined;
  return (
    (await evaluate<Snapshot | null>(tabId, `(${jevSnapshot})(${JSON.stringify(terms)})`)) ??
    undefined
  );
}

/**
 * Read the page once it is worth reading, polling every 100 ms up to
 * OBSERVE_LOAD_MS. Each poll drives the tab afresh: a password manager's
 * frame drops the debugger session mid-observe (the autofill guard removes
 * the frame, but the drop has happened by then), and only a new drive
 * re-attaches. A page whose script throws is an error to surface at once,
 * not "still loading"; any other failure is retried until the bound, and
 * the last one is reported when the bound passes.
 */
async function readWhenSettled(tabId: number, terms: string[]): Promise<Snapshot> {
  const until = Date.now() + OBSERVE_LOAD_MS;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  let lastFailure: string | undefined;
  // The results a click asked for may still be on their way when the document
  // has settled (a search page that shows "Loading…" until its data request
  // lands). Such a page is read again once the in-flight XHR/fetch requests
  // have finished, or NETWORK_IDLE_MS after the first settled read; a
  // page with nothing in flight is read at once.
  let idleUntil: number | undefined;
  let waited = false;
  for (;;) {
    const overdue = Date.now() >= until;
    let snap: Snapshot | undefined;
    try {
      snap = await drivePage(tabId, async () => {
        await armNetwork(tabId);
        return readOnce(tabId, overdue, terms);
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (SCRIPT_FAILED.test(msg)) throw err;
      lastFailure = msg; // the context is being swapped, or the session dropped
    }
    if (snap) {
      idleUntil ??= Date.now() + NETWORK_IDLE_MS;
      if (!overdue && pendingRequests(tabId) > 0 && Date.now() < idleUntil) {
        waited = true;
        await sleep(100);
        continue;
      }
      if (waited) {
        // The last request just landed: give the page a moment to render it.
        waited = false;
        await sleep(150);
        continue;
      }
      return snap;
    }
    if (overdue) {
      throw new Error(
        lastFailure === undefined
          ? "the page did not finish loading"
          : `the page could not be read: ${lastFailure}`,
      );
    }
    await sleep(100);
  }
}

export async function jevObserve(params: JevObserveParams): Promise<JevObservation> {
  const tabId = await resolveTabId(params.tabId);
  const dialog = openDialog(tabId);
  if (dialog) {
    // The page is blocked, but the tabs API still knows where we are.
    const tab = await tabInfo(tabId);
    return {
      url: tab?.url ?? "",
      title: tab?.title ?? "",
      text: "",
      visible: true,
      actions: [],
      dialog,
    };
  }
  return readWhenSettled(tabId, params.terms ?? []);
}

export async function jevAct(params: JevActParams): Promise<JevActResult> {
  const tabId = await resolveTabId(params.tabId);
  if (params.op === "wait") {
    await new Promise((r) => setTimeout(r, 250));
    return { ok: true };
  }
  return drivePage(tabId, async () => {
    // Requests the act sets off are what the next observe waits for.
    await armNetwork(tabId);
    // A handler that opens alert/confirm/prompt freezes the renderer: the
    // input's own response, the press probe and settle all block. Listen for
    // the dialog before sending anything, and let it win the race — the press
    // happened, and the next observe reports the dialog.
    const opened = dialogOpened(tabId);
    const state: ActState = { pressed: false, abandoned: false };
    try {
      const work = act(tabId, params, state);
      const outcome = await Promise.race([work, opened.promise.then(() => DIALOG_WON)]);
      if (typeof outcome !== "symbol") return outcome;
      // The orphaned act resumes once the dialog is answered: it must send no
      // more input, since whatever is focused by then is not our target.
      state.abandoned = true;
      work.catch(() => {}); // the blocked commands fail once the dialog is answered
      // A dialog from elsewhere (a page timer) before our press: nothing happened.
      if (!state.pressed) return { stale: true, reason: "a dialog opened before the action" };
      return { ok: true };
    } finally {
      opened.cancel();
    }
  });
}

const DIALOG_WON = Symbol("dialog");

/** How long a tab a click opened may take to show its first real document. */
const OPENED_TAB_LOAD_MS = 3000;

/**
 * A new tab starts on about:blank and stays there until its navigation
 * commits; read then, the run would see an empty page (or lose the evaluate
 * to the cross-process commit). Wait, bounded, for a committed document that
 * is past "loading". A slow site past the bound is still handed over: observe
 * has its own body wait, and the page-changed rule copes with a late load.
 */
async function awaitOpenedTab(tabId: number): Promise<void> {
  const until = Date.now() + OPENED_TAB_LOAD_MS;
  await drivePage(tabId, async () => {
    while (Date.now() < until) {
      const page = await evaluate<{ href: string; ready: string }>(
        tabId,
        "({ href: location.href, ready: document.readyState })",
      ).catch(() => undefined); // the commit destroyed the context: read again
      if (page && page.href !== "about:blank" && page.ready !== "loading") return;
      await new Promise((r) => setTimeout(r, 100));
    }
  }).catch(() => {}); // a tab that can't be driven is reported all the same
}

/** Watch for a tab this tab opens from script while a click runs. */
function watchOpenedTab(tabId: number): { get: () => number | undefined; stop: () => void } {
  let opened: number | undefined;
  const onCreated = (tab: chrome.tabs.Tab) => {
    if (tab.openerTabId === tabId && tab.id !== undefined && opened === undefined) opened = tab.id;
  };
  // The unit and browser harnesses stub only what they need.
  const events = chrome.tabs.onCreated as typeof chrome.tabs.onCreated | undefined;
  events?.addListener(onCreated);
  return { get: () => opened, stop: () => events?.removeListener(onCreated) };
}

interface ActState {
  /** Set right before the first command that changes the page. */
  pressed: boolean;
  /** Set when a dialog won the race: perform no further input. */
  abandoned: boolean;
}

/** Values up to this length are typed key by key; longer ones are inserted whole. */
export const PER_KEY_MAX_CHARS = 200;

/** The key events one character produces; letters and digits get a code and key code. */
function keyFor(ch: string): Record<string, string | number> {
  if (ch === "\n" || ch === "\r") {
    return { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" };
  }
  const base: Record<string, string | number> = { key: ch, text: ch, unmodifiedText: ch };
  if (/^[a-zA-Z]$/.test(ch)) {
    const upper = ch.toUpperCase();
    return { ...base, code: `Key${upper}`, windowsVirtualKeyCode: upper.charCodeAt(0) };
  }
  if (/^[0-9]$/.test(ch))
    return { ...base, code: `Digit${ch}`, windowsVirtualKeyCode: 48 + Number(ch) };
  if (ch === " ") return { ...base, code: "Space", windowsVirtualKeyCode: 32 };
  return base;
}

/**
 * Put `text` into the focused field the way a person would: one keyDown (with
 * its text, so Chromium generates the keypress and the input) and keyUp per
 * character. `Input.insertText` fires `input` alone; a field whose script
 * re-derives its value on keydown/keyup (formatting, a model it writes back on
 * blur) never sees per-key typing and drops the value. Long values are
 * inserted whole: they are pasted text, not typing, and the per-key round
 * trips would add up.
 */
async function typeText(tabId: number, node: number, text: string, state: ActState): Promise<void> {
  if (text.length > PER_KEY_MAX_CHARS) {
    await send(tabId, "Input.insertText", { text });
    return;
  }
  const chars = [...text];
  let i = 0;
  let drops = 0;
  while (i < chars.length) {
    if (state.abandoned) return;
    const key = keyFor(chars[i] as string);
    try {
      await send(tabId, "Input.dispatchKeyEvent", { type: "keyDown", ...key });
      const { text: _t, unmodifiedText: _u, ...up } = key;
      await send(tabId, "Input.dispatchKeyEvent", { type: "keyUp", ...up });
      i += 1;
    } catch (err) {
      // Typing into a field brings up a password manager's frame, and Chrome
      // drops the debugger session under us. One command (insertText) fell
      // between commands; per-key typing is still sending. Drive the tab
      // again (a new session; the guard clears the frame) and carry on from
      // whatever the field holds, at most twice per act.
      const msg = err instanceof Error ? err.message : String(err);
      if (!SESSION_DROPPED.test(msg) || drops >= TYPE_DROPS_MAX) throw err;
      drops += 1;
      const value = await fieldValueAfterDrop(tabId, node);
      if (state.abandoned) return;
      if (value === chars.slice(0, i + 1).join(""))
        i += 1; // the failed key landed
      else if (value !== chars.slice(0, i).join("")) {
        // The field holds something else (its own script reworked it): start over.
        await selectAll(tabId);
        i = 0;
      }
    }
  }
}

/** A send failure that means the debugger session was dropped under us. */
const SESSION_DROPPED = /detached|not attached/i;
/** Re-attaches one typed value may take. */
const TYPE_DROPS_MAX = 2;
/** How long to keep trying to drive the tab again after a drop. */
const REATTACH_MS = 2000;

/** After a drop: drive the tab again and read what the field holds. The
 *  drop's detach event may not have been dispatched yet, so the first tries
 *  can still hit the dead session; poll until the bound. */
async function fieldValueAfterDrop(tabId: number, node: number): Promise<string> {
  const until = Date.now() + REATTACH_MS;
  let last: unknown;
  for (;;) {
    await new Promise((r) => setTimeout(r, 100));
    try {
      const value = await drivePage(tabId, () =>
        evaluate<string | null>(tabId, `(${jevFieldValue})(${node})`),
      );
      if (value === null) throw new Error("the field is gone");
      return value;
    } catch (err) {
      last = err;
      const msg = err instanceof Error ? err.message : String(err);
      if (!SESSION_DROPPED.test(msg) && !TRANSIENT_DRIVE.test(msg)) throw err;
      if (Date.now() >= until) throw last;
    }
  }
}

/** Drive failures right after a drop that clear once the guard has removed the frame. */
const TRANSIENT_DRIVE = /different extension|cannot access|cannot attach|already attached/i;

async function selectAll(tabId: number): Promise<void> {
  const modifiers = /Mac/i.test(navigator.platform) ? 4 : 2; // Meta on macOS, Ctrl elsewhere
  await send(tabId, "Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "a",
    code: "KeyA",
    modifiers,
    commands: ["selectAll"],
  });
  await send(tabId, "Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA", modifiers });
}

/** The mutation itself, on a tab that is already driven. */
async function act(tabId: number, params: JevActParams, state: ActState): Promise<JevActResult> {
  await ensureVisible(tabId);
  if (params.op === "scroll") {
    const { w, h } = await evaluate<{ w: number; h: number }>(
      tabId,
      "({ w: innerWidth, h: innerHeight })",
    );
    state.pressed = true;
    await send(tabId, "Input.dispatchMouseEvent", {
      type: "mouseWheel",
      x: Math.round(w / 2),
      y: Math.round(h / 2),
      deltaX: 0,
      deltaY: params.delta ?? 560,
    });
    if (state.abandoned) return { ok: true };
    await evaluate(tabId, `(${jevSettle})(null, false)`, true).catch(() => {});
    return { ok: true };
  }
  const node = params.node;
  if (node === undefined) throw new Error(`jev_act ${params.op} needs a node`);
  const check = await evaluate<string>(tabId, `(${jevCheck})(${node})`);
  if (check !== "ok") return { stale: true, reason: check };

  if (params.op === "select") {
    state.pressed = true;
    const r = await evaluate<string>(
      tabId,
      `(${jevSelect})(${node}, ${JSON.stringify(params.value ?? "")})`,
    );
    // A select is a mutation of uncertain outcome if it fails midway: never retry it.
    if (r !== "ok") throw new Error(`select failed: ${r} — check the page before retrying`);
    if (state.abandoned) return { ok: true };
    await evaluate(tabId, `(${jevSettle})(${node}, false)`, true).catch(() => {});
    return { ok: true };
  }

  if (params.op === "submit") {
    // Enter in the field: the keypress is what submits its form (keys.ts).
    const r = await evaluate<string>(tabId, `(${jevSubmitFocus})(${node})`);
    if (r !== "ok") return { stale: true, reason: r };
    // Where the page is now: a router that lands the results by pushState
    // moves the URL, and that move is the surest sign the search took effect.
    const before = await evaluate<string>(tabId, "location.href");
    const enter = {
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
    };
    state.pressed = true;
    await send(tabId, "Input.dispatchKeyEvent", {
      type: "keyDown",
      ...enter,
      text: "\r",
      unmodifiedText: "\r",
    });
    if (state.abandoned) return { ok: true };
    await send(tabId, "Input.dispatchKeyEvent", { type: "keyUp", ...enter });
    if (state.abandoned) return { ok: true };
    // A SPA search (github.com) lands its URL and results a second or two
    // after Enter: two frames would read the old page. Wait for the effect,
    // bounded; a classic form navigation unloads the document, which rejects
    // here, and observe waits for the new one.
    await evaluate(tabId, `(${jevSubmitted})(${JSON.stringify(before)})`, true).catch(() => {});
    return { ok: true };
  }

  let point: { x: number; y: number };
  try {
    point = await actionablePoint(
      tabId,
      `the element reins do chose (node ${node})`,
      params.op === "type" ? "type into" : "click",
      true,
      { node, timeoutMs: JEV_ACTION_TIMEOUT_MS },
    );
  } catch (err) {
    // Covered, moving or gone: nothing happened yet, so re-reading is safe.
    // A transport failure (tab closed, debugger detached) is not stale.
    const reason = err instanceof Error ? err.message : String(err);
    if (!ACTIONABILITY_REFUSAL.test(reason)) throw err;
    return { stale: true, reason };
  }
  // A click may open a new tab: the run follows it, so the tab is reported.
  // A link to a new tab (target=_blank) is opened by the extension itself
  // (pressAt's newTabUrl, from the probe that cancelled the link's own
  // navigation — which would raise Chrome's window over the user's app); a
  // tab the page opened from script is caught by the watcher and brought
  // forward, since Chrome may open it behind.
  const opened = params.op === "click" ? watchOpenedTab(tabId) : undefined;
  let newTabUrl: string | undefined;
  state.pressed = true;
  try {
    try {
      ({ newTabUrl } = await pressAt(tabId, point.x, point.y, `node ${node}`));
    } catch (err) {
      // The press was seen landing on another element: the page moved under
      // the pointer and nothing we intended happened — re-read, as for a
      // covered or vanished target. (`reins click` keeps reporting it as an
      // error: there is no loop behind it to re-observe.)
      const reason = err instanceof Error ? err.message : String(err);
      if (!PRESS_MISSED.test(reason)) throw err;
      return { stale: true, reason };
    }
    if (params.op === "type") {
      if (state.abandoned) return { ok: true };
      await selectAll(tabId);
      if (state.abandoned) return { ok: true };
      await typeText(tabId, node, params.text ?? "", state);
    }
    if (state.abandoned) return { ok: true };
    // Settling is read-only; a navigation mid-settle is fine.
    await evaluate(tabId, `(${jevSettle})(${node}, ${params.op === "type"})`, true).catch(() => {});
  } finally {
    opened?.stop();
  }
  const openedTabId = newTabUrl !== undefined ? await openLinkTab(tabId, newTabUrl) : opened?.get();
  if (openedTabId === undefined) return { ok: true };
  await chrome.tabs.update(openedTabId, { active: true }).catch(() => {});
  await awaitOpenedTab(openedTabId);
  return { ok: true, openedTabId };
}
