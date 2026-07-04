import type {
  ClickParams,
  EvalParams,
  NavigateParams,
  ScreenshotParams,
  SnapshotParams,
  TypeParams,
  WaitForParams,
} from "@reins/protocol";
import { isMonitored } from "./monitor.js";

const PROTOCOL = "1.3";

export async function resolveTabId(tabId?: number): Promise<number> {
  if (typeof tabId === "number") return tabId;
  const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (active?.id === undefined) throw new Error("no active tab");
  return active.id;
}

// Attach errors that mean "try again in a moment", not "give up". The main
// one: driving a tab back-to-back, the previous command's detach can still be
// releasing the debuggee when the next attach lands — Chromium then rejects
// with a transient (and, on some builds, misleading "different extension")
// error. Retrying through it keeps rapid command sequences reliable.
const TRANSIENT_ATTACH =
  /already attached|different extension|cannot attach|cannot access|detached while|target closed/i;

async function attachWithRetry(tabId: number, maxTries = 6): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await chrome.debugger.attach({ tabId }, PROTOCOL);
      return;
    } catch (err) {
      // A monitor may have grabbed the session mid-race; the caller reuses it.
      if (isMonitored(tabId)) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt >= maxTries || !TRANSIENT_ATTACH.test(msg)) {
        let who = "";
        try {
          const targets = await chrome.debugger.getTargets();
          const t = targets.find((x) => x.tabId === tabId);
          who = t
            ? ` [target: attached=${t.attached} type=${t.type} url=${t.url}]`
            : " [target: NOT FOUND in getTargets]";
        } catch {
          // ignore diagnostics failure
        }
        throw new Error(`attach tab ${tabId} failed after ${attempt} tries: ${msg}${who}`);
      }
      await new Promise<void>((r) => setTimeout(r, 50 * attempt));
    }
  }
}

// One shared debugger session per tab, reused across back-to-back commands and
// released after a short idle. Attaching/detaching on every single command is
// what caused the flaky "different extension" races (Chromium hasn't finished
// releasing the debuggee before the next attach lands); keeping the session
// warm removes the churn entirely — the model browser-automation tools use.
interface DebugSession {
  attach: Promise<void>;
  inflight: number;
  idleTimer?: ReturnType<typeof setTimeout>;
}

const SESSIONS = new Map<number, DebugSession>();
const IDLE_DETACH_MS = 4000;

// Purge our cache whenever a tab detaches for any reason — tab closed, DevTools
// opened, crash, or the monitor adopting the session.
export function initDebugSessionListeners(): void {
  chrome.debugger.onDetach.addListener((source) => {
    const tabId = source.tabId;
    if (tabId === undefined) return;
    const session = SESSIONS.get(tabId);
    if (session?.idleTimer) clearTimeout(session.idleTimer);
    SESSIONS.delete(tabId);
  });
}

// Register at import in the extension; a no-op in unit tests where `chrome` is
// stubbed per-case (those call initDebugSessionListeners() after stubbing).
try {
  initDebugSessionListeners();
} catch {
  // `chrome` not available yet — fine.
}

function releaseAfterIdle(tabId: number, session: DebugSession): void {
  if (session.idleTimer) clearTimeout(session.idleTimer);
  session.idleTimer = setTimeout(() => {
    if (SESSIONS.get(tabId) !== session || session.inflight > 0) return;
    SESSIONS.delete(tabId);
    // If the monitor adopted the tab meanwhile, leave it attached for monitoring.
    if (!isMonitored(tabId)) void chrome.debugger.detach({ tabId }).catch(() => {});
  }, IDLE_DETACH_MS);
}

export async function withDebugger<T>(tabId: number, fn: () => Promise<T>): Promise<T> {
  // If the monitor (read_console / read_network) holds this tab, reuse its
  // persistent session untouched.
  if (isMonitored(tabId)) return fn();

  let session = SESSIONS.get(tabId);
  if (!session) {
    // Share one attach promise so concurrent commands never double-attach.
    session = { attach: attachWithRetry(tabId), inflight: 0 };
    SESSIONS.set(tabId, session);
  } else if (session.idleTimer) {
    clearTimeout(session.idleTimer);
    session.idleTimer = undefined;
  }

  session.inflight++;
  try {
    await session.attach;
  } catch (err) {
    session.inflight--;
    if (SESSIONS.get(tabId) === session) SESSIONS.delete(tabId);
    // A monitor may have grabbed the session mid-race; its session serves us too.
    if (isMonitored(tabId)) return fn();
    throw err;
  }

  try {
    return await fn();
  } finally {
    session.inflight--;
    if (session.inflight === 0 && SESSIONS.get(tabId) === session) {
      releaseAfterIdle(tabId, session);
    }
  }
}

/** Test-only: drop all cached debugger sessions + timers between cases. */
export function __resetDebugSessions(): void {
  for (const session of SESSIONS.values()) {
    if (session.idleTimer) clearTimeout(session.idleTimer);
  }
  SESSIONS.clear();
}

// chrome.debugger.sendCommand returns Promise<object|undefined> (loosely typed).
// We go through `unknown` first so TypeScript accepts the narrowing to T.
export function send<T = unknown>(
  tabId: number,
  method: string,
  params?: Record<string, unknown>,
): Promise<T> {
  return chrome.debugger.sendCommand({ tabId }, method, params) as unknown as Promise<T>;
}

export async function cdpNavigate(params: NavigateParams): Promise<{ url: string }> {
  const tabId = await resolveTabId(params.tabId);
  return withDebugger(tabId, async () => {
    if (params.to === "reload") {
      await send(tabId, "Page.reload", {});
    } else if (params.to === "back" || params.to === "forward") {
      await send(tabId, "Runtime.evaluate", { expression: `history.${params.to}()` });
    } else {
      await send(tabId, "Page.navigate", { url: params.to });
    }
    const { result } = await send<{ result: { value: string } }>(tabId, "Runtime.evaluate", {
      expression: "location.href",
      returnByValue: true,
    });
    return { url: result.value };
  });
}

/** Tag interactive/labelled elements with data-reins-ref and return a compact tree + refs. */
const SNAPSHOT_EXPR = `(() => {
  const refs = [];
  let n = 0;
  const sel = "a,button,input,textarea,select,[role],h1,h2,h3,[contenteditable=true]";
  for (const el of document.querySelectorAll(sel)) {
    if (!(el instanceof HTMLElement) || el.offsetParent === null) continue;
    const ref = "e" + (++n);
    el.setAttribute("data-reins-ref", ref);
    const role = el.getAttribute("role") || el.tagName.toLowerCase();
    const name = (el.getAttribute("aria-label") || el.textContent || el.getAttribute("placeholder") || "").trim().slice(0, 80);
    refs.push({ ref, role, name });
  }
  const text = refs.map(r => r.ref + ": " + r.role + " " + JSON.stringify(r.name)).join("\\n");
  return { content: text, refs };
})()`;

export async function cdpSnapshot(
  params: SnapshotParams,
): Promise<{ content: string; refs: Array<{ ref: string; role?: string; name?: string }> }> {
  const tabId = await resolveTabId(params.tabId);
  return withDebugger(tabId, async () => {
    const { result } = await send<{
      result: {
        value: { content: string; refs: Array<{ ref: string; role?: string; name?: string }> };
      };
    }>(tabId, "Runtime.evaluate", { expression: SNAPSHOT_EXPR, returnByValue: true });
    const value = result.value;
    const content = params.maxChars ? value.content.slice(0, params.maxChars) : value.content;
    return { content, refs: value.refs };
  });
}

export function selectorFor(ref?: string, selector?: string): string {
  if (selector) return selector;
  if (ref) return `[data-reins-ref="${ref}"]`;
  throw new Error("requires a ref or selector");
}

export async function cdpClick(params: ClickParams): Promise<{ ok: true }> {
  const tabId = await resolveTabId(params.tabId);
  const css = selectorFor(params.ref, params.selector);
  return withDebugger(tabId, async () => {
    // Resolve element center, then dispatch a trusted click there.
    const { result } = await send<{ result: { value: { x: number; y: number } | null } }>(
      tabId,
      "Runtime.evaluate",
      {
        expression: `(() => { const el = document.querySelector(${JSON.stringify(css)}); if (!el) return null; const r = el.getBoundingClientRect(); el.scrollIntoView({block:"center"}); const r2 = el.getBoundingClientRect(); return { x: r2.x + r2.width/2, y: r2.y + r2.height/2 }; })()`,
        returnByValue: true,
      },
    );
    if (!result.value) throw new Error(`element not found: ${css}`);
    const { x, y } = result.value;
    // CDP synthesizes a real click only when the pressed-button bitmask is set
    // (button alone isn't enough — the target never sees a `click`). Move the
    // pointer first so hit-testing lands on the element under (x, y).
    const buttonBit = params.button === "right" ? 2 : params.button === "middle" ? 4 : 1;
    const base = { x, y, button: params.button, clickCount: params.clickCount };
    await send(tabId, "Input.dispatchMouseEvent", { type: "mouseMoved", x, y, buttons: 0 });
    await send(tabId, "Input.dispatchMouseEvent", {
      type: "mousePressed",
      ...base,
      buttons: buttonBit,
    });
    await send(tabId, "Input.dispatchMouseEvent", {
      type: "mouseReleased",
      ...base,
      buttons: 0,
    });
    return { ok: true };
  });
}

export async function cdpType(params: TypeParams): Promise<{ ok: true }> {
  const tabId = await resolveTabId(params.tabId);
  const css = selectorFor(params.ref, params.selector);
  return withDebugger(tabId, async () => {
    const { result } = await send<{ result: { value: boolean } }>(tabId, "Runtime.evaluate", {
      expression: `(() => { const el = document.querySelector(${JSON.stringify(css)}); if (!el) return false; el.focus(); return true; })()`,
      returnByValue: true,
    });
    if (!result.value) throw new Error(`element not found: ${css}`);
    await send(tabId, "Input.insertText", { text: params.text });
    if (params.submit) {
      for (const type of ["keyDown", "keyUp"]) {
        await send(tabId, "Input.dispatchKeyEvent", {
          type,
          key: "Enter",
          code: "Enter",
          windowsVirtualKeyCode: 13,
        });
      }
    }
    return { ok: true };
  });
}

export async function cdpScreenshot(
  params: ScreenshotParams,
): Promise<{ data: string; mimeType: string }> {
  const tabId = await resolveTabId(params.tabId);
  return withDebugger(tabId, async () => {
    const fmt = params.format ?? "png";
    const res = await send<{ data: string }>(tabId, "Page.captureScreenshot", {
      format: fmt,
      captureBeyondViewport: params.fullPage ?? false,
    });
    return { data: res.data, mimeType: fmt === "jpeg" ? "image/jpeg" : "image/png" };
  });
}

export async function cdpEval(params: EvalParams): Promise<{ value: unknown }> {
  const tabId = await resolveTabId(params.tabId);
  return withDebugger(tabId, async () => {
    const res = await send<{
      result: { value: unknown };
      exceptionDetails?: { exception?: { description?: string }; text?: string };
    }>(tabId, "Runtime.evaluate", {
      expression: params.expression,
      returnByValue: true,
      awaitPromise: params.awaitPromise ?? false,
    });
    if (res.exceptionDetails) {
      throw new Error(
        res.exceptionDetails.exception?.description ??
          res.exceptionDetails.text ??
          "evaluation failed",
      );
    }
    return { value: res.result.value };
  });
}

export async function cdpWaitFor(params: WaitForParams): Promise<{ ok: true }> {
  const tabId = await resolveTabId(params.tabId);
  const css = selectorFor(params.ref, params.selector);
  const state = params.state ?? "visible";
  const timeoutMs = params.timeoutMs ?? 5000;

  let checkExpr: string;
  if (state === "present") {
    checkExpr = `!!document.querySelector(${JSON.stringify(css)})`;
  } else if (state === "visible") {
    checkExpr = `(() => {
      const el = document.querySelector(${JSON.stringify(css)});
      if (!el) return false;
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
    })()`;
  } else {
    // hidden: element missing OR not visible
    checkExpr = `(() => {
      const el = document.querySelector(${JSON.stringify(css)});
      if (!el) return true;
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return !(r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none");
    })()`;
  }

  return withDebugger(tabId, async () => {
    const deadline = Date.now() + timeoutMs;
    while (true) {
      const res = await send<{
        result: { value: boolean };
        exceptionDetails?: { exception?: { description?: string }; text?: string };
      }>(tabId, "Runtime.evaluate", { expression: checkExpr, returnByValue: true });
      if (res.exceptionDetails) {
        throw new Error(
          res.exceptionDetails.exception?.description ??
            res.exceptionDetails.text ??
            "wait_for check failed",
        );
      }
      if (res.result.value) return { ok: true };
      if (Date.now() >= deadline) {
        throw new Error(`wait_for timed out after ${timeoutMs}ms for ${css} (${state})`);
      }
      await new Promise<void>((r) => setTimeout(r, 100));
    }
  });
}
