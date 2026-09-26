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
      DIALOGS.set(tabId, { type: p.type ?? "dialog", message: p.message ?? "" });
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

export async function jevObserve(params: JevObserveParams): Promise<JevObservation> {
  const tabId = await resolveTabId(params.tabId);
  const dialog = openDialog(tabId);
  if (dialog) return { url: "", title: "", text: "", visible: true, actions: [], dialog };
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
    await ensureVisible(tabId);
    if (params.op === "scroll") {
      const { w, h } = await evaluate<{ w: number; h: number }>(
        tabId,
        "({ w: innerWidth, h: innerHeight })",
      );
      await send(tabId, "Input.dispatchMouseEvent", {
        type: "mouseWheel",
        x: Math.round(w / 2),
        y: Math.round(h / 2),
        deltaX: 0,
        deltaY: params.delta ?? 560,
      });
      await evaluate(tabId, `(${jevSettle})(null, false)`, true).catch(() => {});
      return { ok: true };
    }
    const node = params.node;
    if (node === undefined) throw new Error(`jev_act ${params.op} needs a node`);
    const check = await evaluate<string>(tabId, `(${jevCheck})(${node})`);
    if (check !== "ok") return { stale: true, reason: check };

    if (params.op === "select") {
      const r = await evaluate<string>(
        tabId,
        `(${jevSelect})(${node}, ${JSON.stringify(params.value ?? "")})`,
      );
      // A select is a mutation of uncertain outcome if it fails midway: never retry it.
      if (r !== "ok") throw new Error(`select failed: ${r} — check the page before retrying`);
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
      return { stale: true, reason: err instanceof Error ? err.message : String(err) };
    }
    await pressAt(tabId, point.x, point.y, `node ${node}`);
    if (params.op === "type") {
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
      await send(tabId, "Input.insertText", { text: params.text ?? "" });
    }
    // Settling is read-only; a navigation mid-settle is fine.
    await evaluate(tabId, `(${jevSettle})(${node}, ${params.op === "type"})`, true).catch(() => {});
    return { ok: true };
  });
}
