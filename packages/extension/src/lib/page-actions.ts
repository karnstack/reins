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
import { resolveTabId, selectorFor, send, withDebugger } from "./cdp.js";
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
      res.exceptionDetails.exception?.description ?? res.exceptionDetails.text ?? "evaluation failed",
    );
  }
  return res.result.value;
}

export async function pressKey(params: PressKeyParams): Promise<{ ok: true }> {
  const tabId = await resolveTabId(params.tabId);
  const spec = parseKeySpec(params.key);
  return withDebugger(tabId, async () => {
    for (const type of ["keyDown", "keyUp"]) {
      await send(tabId, "Input.dispatchKeyEvent", {
        type,
        key: spec.key,
        code: spec.code,
        windowsVirtualKeyCode: spec.keyCode,
        nativeVirtualKeyCode: spec.keyCode,
        modifiers: spec.modifiers,
      });
    }
    return { ok: true };
  });
}

export async function hover(params: HoverParams): Promise<{ ok: true }> {
  const tabId = await resolveTabId(params.tabId);
  const css = selectorFor(params.ref, params.selector);
  return withDebugger(tabId, async () => {
    const center = await evaluate<{ x: number; y: number } | null>(
      tabId,
      `(() => { const el = document.querySelector(${JSON.stringify(css)}); if (!el) return null; el.scrollIntoView({block:"center"}); const r = el.getBoundingClientRect(); return { x: r.x + r.width/2, y: r.y + r.height/2 }; })()`,
    );
    if (!center) throw new Error(`element not found: ${css}`);
    await send(tabId, "Input.dispatchMouseEvent", { type: "mouseMoved", x: center.x, y: center.y });
    return { ok: true };
  });
}

export async function scroll(params: ScrollParams): Promise<{ ok: true }> {
  const tabId = await resolveTabId(params.tabId);
  let expression: string;
  if (params.ref !== undefined || params.selector !== undefined) {
    const css = selectorFor(params.ref, params.selector);
    expression = `(() => { const el = document.querySelector(${JSON.stringify(css)}); if (!el) return false; el.scrollIntoView({block:"center"}); return true; })()`;
  } else if (params.by) {
    expression = `(window.scrollBy(${params.by.dx}, ${params.by.dy}), true)`;
  } else if (params.to === "top") {
    expression = "(window.scrollTo(0, 0), true)";
  } else {
    expression = "(window.scrollTo(0, document.documentElement.scrollHeight), true)";
  }
  return withDebugger(tabId, async () => {
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
    const el = document.querySelector(${JSON.stringify(css)});
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
  return withDebugger(tabId, async () => {
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
    const el = document.querySelector(${JSON.stringify(css)});
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
  return withDebugger(tabId, async () => {
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
  return withDebugger(tabId, async () => {
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
  const target = hasTarget
    ? `document.querySelector(${JSON.stringify(selectorFor(params.ref, params.selector))})`
    : "document.body";
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
  return withDebugger(tabId, async () => {
    await send(tabId, "Page.enable", {});
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
