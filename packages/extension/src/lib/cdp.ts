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

export async function withDebugger<T>(tabId: number, fn: () => Promise<T>): Promise<T> {
  // Chrome allows one debugger session per tab. If the monitor (read_console /
  // read_network) already holds it, reuse that session — and leave it attached
  // afterwards so monitoring continues.
  if (isMonitored(tabId)) return fn();
  try {
    await chrome.debugger.attach({ tabId }, PROTOCOL);
  } catch (err) {
    // Lost a race with a monitor attach; its session serves our commands too.
    if (isMonitored(tabId)) return fn();
    throw err;
  }
  try {
    return await fn();
  } finally {
    await chrome.debugger.detach({ tabId }).catch(() => {});
  }
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
    const base = { x, y, button: params.button, clickCount: params.clickCount };
    await send(tabId, "Input.dispatchMouseEvent", { type: "mousePressed", ...base });
    await send(tabId, "Input.dispatchMouseEvent", { type: "mouseReleased", ...base });
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
