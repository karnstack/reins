import type {
  ClickParams,
  ClickResult,
  EvalParams,
  NavigateParams,
  OpenTabParams,
  OpenTabResult,
  ScreenshotParams,
  SnapshotParams,
  TypeParams,
  WaitForParams,
} from "@reins/protocol";
import { actionPoint, type ProbeResult, readProbe } from "./actionability.js";
import { autofillGuard } from "./autofill-guard.js";
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

/**
 * Build a human-actionable attach error. When getTargets shows the tab is
 * already `attached`, another debugger client (Claude-in-Chrome, Dia's AI,
 * DevTools) holds the one-per-tab slot — the real, unrecoverable cause behind
 * Chromium's cryptic "different extension" text.
 */
async function attachErrorMessage(tabId: number, attempt: number, msg: string): Promise<string> {
  try {
    const targets = await chrome.debugger.getTargets();
    const t = targets.find((x) => x.tabId === tabId);
    if (t?.attached) {
      return `cannot drive tab ${tabId}: another debugger is already attached to it (DevTools, or an extension like Claude-in-Chrome, or the browser's own AI). Chrome allows only one debugger per tab. Close the other tool, or run reins in a separate browser profile.`;
    }
    if (/different extension/i.test(msg)) {
      return `cannot drive tab ${tabId}: another extension has a frame in it — usually a password manager's autofill menu (1Password, Bitwarden, …) that opened before reins could clear it. Chrome blocks debugging while it's there. Close the menu (Escape, or click elsewhere on the page), then retry — or reopen the page with \`reins open\`, which guards it from the first load.`;
    }
    const detail = t ? `attached=${t.attached} url=${t.url}` : "not in getTargets";
    return `attach tab ${tabId} failed after ${attempt} tries: ${msg} [${detail}]`;
  } catch {
    return `attach tab ${tabId} failed after ${attempt} tries: ${msg}`;
  }
}

/**
 * Make the page report focus. A tab reins opened (about:blank, then
 * navigated) or drives from the shell leaves Chrome's omnibox focused, so in
 * the page `document.hasFocus()` is false — and sites that key behaviour off
 * focus (GitHub's search combobox, a password manager's "menu is available"
 * text) diverge from a human session. The emulation belongs to the debugger
 * session, so every attach — any command, not only `reins do` — enables it
 * once. Best-effort: a target that refuses it still runs the command.
 */
export async function emulateFocus(tabId: number): Promise<void> {
  try {
    await send(tabId, "Emulation.setFocusEmulationEnabled", { enabled: true });
  } catch {
    // Not a page target, or an older Chrome — the command itself still runs.
  }
}

async function attachWithRetry(tabId: number, maxTries = 6): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await chrome.debugger.attach({ tabId }, PROTOCOL);
      await emulateFocus(tabId);
      return;
    } catch (err) {
      // A monitor may have grabbed the session mid-race; the caller reuses it.
      if (isMonitored(tabId)) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt >= maxTries || !TRANSIENT_ATTACH.test(msg)) {
        throw new Error(await attachErrorMessage(tabId, attempt, msg));
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
// Per tab: the current debugger session has Page enabled for the autofill
// guard, and (once registered) the id of its new-document script. Cleared
// whenever that session ends — its scripts die with it.
const GUARD_SCRIPTS = new Map<number, string | undefined>();
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
    GUARD_SCRIPTS.delete(tabId);
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
    if (!isMonitored(tabId)) {
      GUARD_SCRIPTS.delete(tabId);
      void chrome.debugger.detach({ tabId }).catch(() => {});
    }
  }, IDLE_DETACH_MS);
}

/** How long the autofill guard stays up after the last command. */
const AUTOFILL_LEASE_MS = 30_000;

/**
 * Renew the in-page autofill guard's lease (see autofill-guard.ts), and have
 * this session install it in every new document too: a page reached by a
 * click (a login screen that autofocuses its field) would otherwise open the
 * autofill menu before the next command could arm it. New documents only get
 * what's left of this lease — never a fresh one — so the guard stands down on
 * schedule even when a session outlives the agent (the monitor keeps its).
 */
async function armAutofillGuard(tabId: number): Promise<void> {
  const until = Date.now() + AUTOFILL_LEASE_MS;
  try {
    if (!GUARD_SCRIPTS.has(tabId)) {
      // New-document scripts only fire once the Page domain is enabled.
      await send(tabId, "Page.enable", {});
      GUARD_SCRIPTS.set(tabId, undefined);
    }
    const previous = GUARD_SCRIPTS.get(tabId);
    if (previous !== undefined) {
      await send(tabId, "Page.removeScriptToEvaluateOnNewDocument", { identifier: previous });
    }
    const added = await send<{ identifier?: string } | undefined>(
      tabId,
      "Page.addScriptToEvaluateOnNewDocument",
      { source: `(${autofillGuard})(${until} - Date.now())` },
    );
    GUARD_SCRIPTS.set(tabId, added?.identifier);
    await send(tabId, "Runtime.evaluate", {
      expression: `(${autofillGuard})(${AUTOFILL_LEASE_MS})`,
      returnByValue: true,
    });
  } catch {
    // Mid-navigation or an unscriptable page — the command itself still runs.
  }
}

/**
 * Run `fn` with a debugger session on the tab. `guard` arms the autofill guard
 * first — for commands that drive the page. Everything else leaves the page
 * untouched: reads must not mutate it, and a command that has to work under a
 * JS dialog (which blocks every evaluate) can't wait on one.
 */
export async function withDebugger<T>(
  tabId: number,
  fn: () => Promise<T>,
  opts: { guard?: boolean } = {},
): Promise<T> {
  // If the monitor (read_console / read_network) holds this tab, reuse its
  // persistent session untouched.
  if (isMonitored(tabId)) {
    if (opts.guard) await armAutofillGuard(tabId);
    return fn();
  }

  let session = SESSIONS.get(tabId);
  if (!session) {
    // Share one attach promise so concurrent commands never double-attach.
    GUARD_SCRIPTS.delete(tabId); // a fresh session starts with no scripts
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
    if (opts.guard) await armAutofillGuard(tabId);
    return await fn();
  } finally {
    session.inflight--;
    if (session.inflight === 0 && SESSIONS.get(tabId) === session) {
      releaseAfterIdle(tabId, session);
    }
  }
}

/** `withDebugger` for commands that drive the page: arms the autofill guard. */
export function drivePage<T>(tabId: number, fn: () => Promise<T>): Promise<T> {
  return withDebugger(tabId, fn, { guard: true });
}

/** Test-only: drop all cached debugger sessions + timers between cases. */
export function __resetDebugSessions(): void {
  for (const session of SESSIONS.values()) {
    if (session.idleTimer) clearTimeout(session.idleTimer);
  }
  SESSIONS.clear();
  GUARD_SCRIPTS.clear();
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

/**
 * Open `url` in a new tab with the autofill guard in place before the page's
 * first script. Creating the tab at the URL directly would let a login page
 * autofocus its field — and a password manager open its menu, locking the
 * debugger out — before reins ever attached.
 */
export async function cdpOpenTab({ url, activate }: OpenTabParams): Promise<OpenTabResult> {
  const created = await chrome.tabs.create({ url: "about:blank", active: activate });
  const tabId = created.id;
  if (tabId === undefined) return { tabId: -1 };
  try {
    // A failed load (network error, a download) already shows in the tab;
    // navigating again would repeat it.
    await drivePage(tabId, () => send(tabId, "Page.navigate", { url }));
  } catch {
    // The debugger can't drive this tab: open the URL plainly.
    await chrome.tabs.update(tabId, { url });
  }
  return { tabId };
}

export async function cdpNavigate(params: NavigateParams): Promise<{ url: string }> {
  const tabId = await resolveTabId(params.tabId);
  return drivePage(tabId, async () => {
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

/** How long click/hover wait for their target to become actionable. */
const ACTION_TIMEOUT_MS = 5000;

/**
 * Make sure the tab can receive trusted input, bringing it to the front if not.
 * Chromium holds CDP input for a hidden tab — the command hangs, and the queued
 * click or keypress fires whenever the tab is next shown. Never queue it.
 */
export async function ensureVisible(tabId: number): Promise<void> {
  const visible = async () => {
    const { result } = await send<{ result: { value: string } }>(tabId, "Runtime.evaluate", {
      expression: "document.visibilityState",
      returnByValue: true,
    });
    return result.value === "visible";
  };
  if (await visible()) return;
  await chrome.tabs.update(tabId, { active: true });
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 50));
    if (await visible()) return;
  }
  throw new Error(
    `tab ${tabId} is not visible (is its window minimized?) — the browser only delivers clicks and key presses to visible tabs. Restore the window, then retry.`,
  );
}

/**
 * Resolve a point where trusted pointer input will land on the element.
 * `opts.node` targets a Jev node id instead of the selector (which then only
 * names the element in errors); `opts.timeoutMs` overrides the default wait.
 */
export async function actionablePoint(
  tabId: number,
  css: string,
  action: string,
  forClick: boolean,
  opts: { node?: number; timeoutMs?: number } = {},
): Promise<{ x: number; y: number }> {
  const { result } = await send<{
    result: { value: { x: number; y: number } | { error: string } };
  }>(tabId, "Runtime.evaluate", {
    expression: `(${actionPoint})(${JSON.stringify(css)}, ${opts.timeoutMs ?? ACTION_TIMEOUT_MS}, ${forClick}, ${opts.node ?? null})`,
    returnByValue: true,
    awaitPromise: true,
  });
  const point = result.value;
  if ("error" in point) {
    if (point.error === "notfound") throw new Error(`element not found: ${css}`);
    throw new Error(`cannot ${action} ${css}: ${point.error}`);
  }
  return point;
}

/**
 * Press at (x, y) and confirm the press reached the element `actionablePoint`
 * armed the probe on. Only a press seen landing elsewhere fails; `what` names
 * the target in that error.
 *
 * `button` and `clickCount` default here because the CLI omits them unless
 * flagged, and nothing applies the schema defaults on the way in. They must be
 * explicit: CDP's own defaults (button "none", clickCount 0) move the pointer
 * but never press.
 */
/** pressAt's refusal when the press was seen landing on another element. */
export const PRESS_MISSED = /landed on .+ instead — the page changed under the pointer/;

/**
 * Open `url` — a link's cancelled new-tab navigation — as the tab a click on
 * the link would have opened: next to the opener, active, owing it as opener.
 * chrome.tabs.create shows the tab inside Chrome without raising Chrome's
 * window over the app the user is working in, which the link's own
 * navigation would have done.
 */
export async function openLinkTab(tabId: number, url: string): Promise<number | undefined> {
  const opener = await chrome.tabs.get(tabId);
  const created = await chrome.tabs.create({
    url,
    windowId: opener.windowId,
    index: opener.index + 1,
    openerTabId: tabId,
    active: true,
  });
  return created.id;
}

export async function pressAt(
  tabId: number,
  x: number,
  y: number,
  what: string,
  button: "left" | "right" | "middle" = "left",
  clickCount = 1,
): Promise<{ newTabUrl?: string }> {
  // CDP synthesizes a real click only when the pressed-button bitmask is set
  // (button alone isn't enough — the target never sees a `click`). Move the
  // pointer first so hit-testing lands on the element under (x, y).
  const buttonBit = button === "right" ? 2 : button === "middle" ? 4 : 1;
  const base = { x, y, button, clickCount };
  await send(tabId, "Input.dispatchMouseEvent", { type: "mouseMoved", x, y, buttons: 0 });
  await send(tabId, "Input.dispatchMouseEvent", {
    type: "mousePressed",
    ...base,
    buttons: buttonBit,
  });
  await send(tabId, "Input.dispatchMouseEvent", { type: "mouseReleased", ...base, buttons: 0 });
  // Confirm the press reached the element — never report a click that missed.
  // A throw or a vanished probe means the click navigated: that's success.
  const probe = await send<{ result: { value: ProbeResult | null } }>(tabId, "Runtime.evaluate", {
    expression: `(${readProbe})()`,
    returnByValue: true,
  }).then(
    (r) => r.result.value,
    () => null,
  );
  // Only a press seen landing elsewhere is a failure. Seeing nothing proves
  // nothing — a page listener may have stopped the event first — and
  // failing a click that landed makes the agent click twice.
  if (probe?.state === "missed") {
    throw new Error(
      `click on ${what} landed on ${probe.by} instead — the page changed under the pointer. Re-snapshot and retry.`,
    );
  }
  // The press activated a link to a new tab: the probe cancelled the link's
  // own navigation (it would raise Chrome's window over the user's app) and
  // the caller opens the URL as a tab itself — see actionPoint.
  return probe?.newTabUrl !== undefined ? { newTabUrl: probe.newTabUrl } : {};
}

export async function cdpClick(params: ClickParams): Promise<ClickResult> {
  const tabId = await resolveTabId(params.tabId);
  const css = selectorFor(params.ref, params.selector);
  const button = params.button ?? "left";
  const clickCount = params.clickCount ?? 1;
  return drivePage(tabId, async () => {
    await ensureVisible(tabId);
    const { x, y } = await actionablePoint(tabId, css, "click", true);
    const { newTabUrl } = await pressAt(tabId, x, y, css, button, clickCount);
    if (newTabUrl === undefined) return { ok: true };
    // The user sees the new tab as after a normal click, without Chrome
    // raising its window over the app they are working in.
    const openedTabId = await openLinkTab(tabId, newTabUrl);
    return openedTabId === undefined ? { ok: true } : { ok: true, openedTabId };
  });
}

export async function cdpType(params: TypeParams): Promise<{ ok: true }> {
  const tabId = await resolveTabId(params.tabId);
  const css = selectorFor(params.ref, params.selector);
  return drivePage(tabId, async () => {
    await ensureVisible(tabId);
    const { result } = await send<{ result: { value: boolean } }>(tabId, "Runtime.evaluate", {
      expression: `(() => { const el = document.querySelector(${JSON.stringify(css)}); if (!el) return false; el.focus(); return true; })()`,
      returnByValue: true,
    });
    if (!result.value) throw new Error(`element not found: ${css}`);
    await send(tabId, "Input.insertText", { text: params.text });
    if (params.submit) {
      // Enter needs its text, or no keypress is generated and nothing submits.
      const enter = { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 };
      await send(tabId, "Input.dispatchKeyEvent", {
        type: "keyDown",
        ...enter,
        text: "\r",
        unmodifiedText: "\r",
      });
      await send(tabId, "Input.dispatchKeyEvent", { type: "keyUp", ...enter });
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
