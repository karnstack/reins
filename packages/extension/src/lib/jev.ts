import type {
  JevActParams,
  JevActResult,
  JevDialog,
  JevObservation,
  JevObserveParams,
} from "@reins/protocol";
import { actionablePoint, drivePage, ensureVisible, pressAt, resolveTabId, send } from "./cdp.js";
import { jevCheck, jevSelect, jevSettle, jevSnapshot } from "./jev-snapshot.js";

/** reins do waits this long for a covered or moving target, then re-reads the page. */
export const JEV_ACTION_TIMEOUT_MS = 500;

const DIALOGS = new Map<number, JevDialog>();
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
    }
  });
  chrome.debugger.onDetach.addListener((source) => {
    if (source.tabId !== undefined) DIALOGS.delete(source.tabId);
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

/** url/title from the tabs API (no CDP), or nothing when the lookup fails. */
async function tabInfo(tabId: number): Promise<{ url?: string; title?: string } | undefined> {
  try {
    return await chrome.tabs.get(tabId);
  } catch {
    return undefined;
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
  return drivePage(tabId, async () => {
    // A navigating document has no body yet: give it up to ~0.5 s.
    for (let i = 0; i < 10; i++) {
      const snap = await evaluate<Omit<JevObservation, "dialog"> | null>(
        tabId,
        `(${jevSnapshot})()`,
      ).catch(() => null);
      if (snap) return snap;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error("the page did not finish loading");
  });
}

export async function jevAct(params: JevActParams): Promise<JevActResult> {
  const tabId = await resolveTabId(params.tabId);
  if (params.op === "wait") {
    await new Promise((r) => setTimeout(r, 250));
    return { ok: true };
  }
  return drivePage(tabId, async () => {
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

interface ActState {
  /** Set right before the first command that changes the page. */
  pressed: boolean;
  /** Set when a dialog won the race: perform no further input. */
  abandoned: boolean;
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
  state.pressed = true;
  await pressAt(tabId, point.x, point.y, `node ${node}`);
  if (params.op === "type") {
    if (state.abandoned) return { ok: true };
    const modifiers = /Mac/i.test(navigator.platform) ? 4 : 2; // Meta on macOS, Ctrl elsewhere
    await send(tabId, "Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "a",
      code: "KeyA",
      modifiers,
      commands: ["selectAll"],
    });
    await send(tabId, "Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "a",
      code: "KeyA",
      modifiers,
    });
    if (state.abandoned) return { ok: true };
    await send(tabId, "Input.insertText", { text: params.text ?? "" });
  }
  if (state.abandoned) return { ok: true };
  // Settling is read-only; a navigation mid-settle is fine.
  await evaluate(tabId, `(${jevSettle})(${node}, ${params.op === "type"})`, true).catch(() => {});
  return { ok: true };
}
