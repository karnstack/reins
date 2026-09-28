import type {
  CdpParams,
  DialogParams,
  FillParams,
  HoverParams,
  PressKeyParams,
  ReadTextParams,
  ScrollParams,
  SelectOptionParams,
  UploadParams,
} from "@reins/protocol";
import {
  actionablePoint,
  drivePage,
  ensureVisible,
  resolveTabId,
  selectorFor,
  send,
  targetExpr,
  withDebugger,
} from "./cdp.js";
import { parseKeySpec } from "./keys.js";

type Evaluated<T> = {
  result: { value: T };
  exceptionDetails?: { exception?: { description?: string }; text?: string };
};

async function evaluate<T>(tabId: number, expression: string): Promise<T> {
  const res = await send<Evaluated<T>>(tabId, "Runtime.evaluate", {
    expression,
    returnByValue: true,
  });
  if (res.exceptionDetails) {
    throw new Error(
      res.exceptionDetails.exception?.description ??
        res.exceptionDetails.text ??
        "evaluation failed",
    );
  }
  return res.result.value;
}

export async function pressKey(params: PressKeyParams): Promise<{ ok: true }> {
  const tabId = await resolveTabId(params.tabId);
  const spec = parseKeySpec(params.key);
  const key = {
    key: spec.key,
    code: spec.code,
    windowsVirtualKeyCode: spec.keyCode,
    nativeVirtualKeyCode: spec.keyCode,
    modifiers: spec.modifiers,
  };
  return drivePage(tabId, async () => {
    await ensureVisible(tabId);
    // With text, keyDown also generates the keypress (Enter submits, letters
    // type); without it, rawKeyDown is the plain key-down — as Puppeteer does.
    await send(
      tabId,
      "Input.dispatchKeyEvent",
      spec.text === undefined
        ? { type: "rawKeyDown", ...key }
        : { type: "keyDown", ...key, text: spec.text, unmodifiedText: spec.text },
    );
    await send(tabId, "Input.dispatchKeyEvent", { type: "keyUp", ...key });
    return { ok: true };
  });
}

export async function hover(params: HoverParams): Promise<{ ok: true }> {
  const tabId = await resolveTabId(params.tabId);
  const css = selectorFor(params.ref, params.selector);
  return drivePage(tabId, async () => {
    await ensureVisible(tabId);
    const { x, y } = await actionablePoint(tabId, css, "hover", false, {
      locate: targetExpr(params.ref, params.selector),
    });
    await send(tabId, "Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
    return { ok: true };
  });
}

export async function scroll(params: ScrollParams): Promise<{ ok: true }> {
  const tabId = await resolveTabId(params.tabId);
  let expression: string;
  if (params.ref !== undefined || params.selector !== undefined) {
    expression = `(() => { const el = ${targetExpr(params.ref, params.selector)}; if (!el) return false; el.scrollIntoView({block:"center"}); return true; })()`;
  } else if (params.by) {
    expression = `(window.scrollBy(${params.by.dx}, ${params.by.dy}), true)`;
  } else if (params.to === "top") {
    expression = "(window.scrollTo(0, 0), true)";
  } else {
    expression = "(window.scrollTo(0, document.documentElement.scrollHeight), true)";
  }
  return drivePage(tabId, async () => {
    const found = await evaluate<boolean>(tabId, expression);
    if (!found) throw new Error(`element not found: ${selectorFor(params.ref, params.selector)}`);
    return { ok: true };
  });
}

export async function fill(params: FillParams): Promise<{ ok: true }> {
  const tabId = await resolveTabId(params.tabId);
  const css = selectorFor(params.ref, params.selector);
  const value = JSON.stringify(params.value);
  // Native value setter so frameworks (React) observe the change; then the
  // events a real user interaction would produce.
  const expression = `(() => {
    const el = ${targetExpr(params.ref, params.selector)};
    if (!el) return false;
    el.focus();
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
      : el instanceof HTMLInputElement ? HTMLInputElement.prototype : null;
    const desc = proto ? Object.getOwnPropertyDescriptor(proto, "value") : null;
    if (desc && desc.set) desc.set.call(el, ${value});
    else if (el.isContentEditable) el.textContent = ${value};
    else el.value = ${value};
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`;
  return drivePage(tabId, async () => {
    const found = await evaluate<boolean>(tabId, expression);
    if (!found) throw new Error(`element not found: ${css}`);
    return { ok: true };
  });
}

export async function selectOption(params: SelectOptionParams): Promise<{ ok: true }> {
  const tabId = await resolveTabId(params.tabId);
  const css = selectorFor(params.ref, params.selector);
  const value = JSON.stringify(params.value);
  // Match by option value first, then by visible label.
  const expression = `(() => {
    const el = ${targetExpr(params.ref, params.selector)};
    if (!el) return "missing";
    if (!(el instanceof HTMLSelectElement)) return "notselect";
    el.value = ${value};
    if (el.value !== ${value}) {
      const byLabel = [...el.options].find(o => o.label.trim() === ${value} || o.text.trim() === ${value});
      if (!byLabel) return "nooption";
      el.value = byLabel.value;
    }
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return "ok";
  })()`;
  return drivePage(tabId, async () => {
    const outcome = await evaluate<string>(tabId, expression);
    if (outcome === "missing") throw new Error(`element not found: ${css}`);
    if (outcome === "notselect") throw new Error(`not a <select> element: ${css}`);
    if (outcome === "nooption") throw new Error(`no option matching ${params.value} in ${css}`);
    return { ok: true };
  });
}

export async function upload(params: UploadParams): Promise<{ ok: true }> {
  const tabId = await resolveTabId(params.tabId);
  const css = selectorFor(params.ref, params.selector);
  return drivePage(tabId, async () => {
    if (!params.selector && params.ref) {
      // A ref may sit in an open shadow root, out of DOM.querySelector's reach:
      // hand CDP the element itself.
      const { result } = await send<{ result: { objectId?: string; subtype?: string } }>(
        tabId,
        "Runtime.evaluate",
        { expression: targetExpr(params.ref) },
      );
      if (!result.objectId || result.subtype === "null")
        throw new Error(`element not found: ${css}`);
      const { objectId } = result;
      try {
        await send(tabId, "DOM.setFileInputFiles", { files: params.files, objectId });
      } finally {
        await send(tabId, "Runtime.releaseObject", { objectId }).catch(() => {});
      }
      return { ok: true };
    }
    const doc = await send<{ root: { nodeId: number } }>(tabId, "DOM.getDocument", { depth: 0 });
    const { nodeId } = await send<{ nodeId: number }>(tabId, "DOM.querySelector", {
      nodeId: doc.root.nodeId,
      selector: css,
    });
    if (!nodeId) throw new Error(`element not found: ${css}`);
    await send(tabId, "DOM.setFileInputFiles", { files: params.files, nodeId });
    return { ok: true };
  });
}

export async function readText(params: ReadTextParams): Promise<{ text: string }> {
  const tabId = await resolveTabId(params.tabId);
  const hasTarget = params.ref !== undefined || params.selector !== undefined;
  const target = hasTarget ? targetExpr(params.ref, params.selector) : "document.body";
  const expression = `(() => { const el = ${target}; return el ? el.innerText : null; })()`;
  return withDebugger(tabId, async () => {
    const text = await evaluate<string | null>(tabId, expression);
    if (text === null) {
      throw new Error(`element not found: ${selectorFor(params.ref, params.selector)}`);
    }
    return { text: params.maxChars ? text.slice(0, params.maxChars) : text };
  });
}

export async function handleDialog(params: DialogParams): Promise<{ ok: true }> {
  const tabId = await resolveTabId(params.tabId);
  // No Page.enable here: it hangs while a dialog is open, and a dialog is only
  // answerable if Page was already enabled when it opened — which the
  // commands that drive the page do (via the autofill guard).
  return withDebugger(tabId, async () => {
    try {
      await send(tabId, "Page.handleJavaScriptDialog", {
        accept: params.accept,
        ...(params.promptText !== undefined ? { promptText: params.promptText } : {}),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/no dialog/i.test(msg)) throw new Error("no JavaScript dialog is open on this tab");
      throw err;
    }
    return { ok: true };
  });
}

/** Raw CDP passthrough — the escape hatch to the full protocol. */
export async function cdpRaw(params: CdpParams): Promise<{ result: unknown }> {
  const tabId = await resolveTabId(params.tabId);
  return withDebugger(tabId, async () => {
    const result = await send<unknown>(tabId, params.method, params.params ?? {});
    return { result: result ?? null };
  });
}
