/**
 * Page-side halves of `reins do`. Each runs *inside the page* via
 * Runtime.evaluate, serialized with Function.prototype.toString, so it must
 * stay self-contained: no imports, no references to module scope.
 *
 * Ported from browser-use/jev-ultrafast `snapshot.js` (MIT). Differences: the
 * cache lives under a symbol, not a page global; rects and scroll are left out
 * of the result (the daemon's change check must ignore reins' own
 * scrollIntoView); guards are kept page-side for jevCheck.
 */

import type { JevAction } from "@reins/protocol";

interface JevCache {
  ids: WeakMap<Element, number>;
  nodes: Map<number, Element>;
  next: number;
  guards: Record<number, string>;
  guard: (el: Element | undefined) => string | null;
  /** May Enter be pressed in this field? Re-checked at act time. */
  submittable: (el: Element | undefined) => boolean;
}

/** The protocol's action, before jevView assigns ids. A type-only import is
 *  erased, so the serialized function stays self-contained. */
type Action = Omit<JevAction, "id"> & { id?: string };

export function jevSnapshot(): {
  url: string;
  title: string;
  text: string;
  visible: boolean;
  actions: Action[];
} | null {
  if (!document.body) return null;
  const KEY = Symbol.for("reins.jev");
  const w = window as unknown as Record<symbol, JevCache | undefined>;
  let cache = w[KEY];
  if (!cache) {
    cache = {
      ids: new WeakMap(),
      nodes: new Map(),
      next: 1,
      guards: {},
      guard: () => null,
      submittable: () => false,
    };
    w[KEY] = cache;
  }
  const c = cache;
  const identity = (e: Element): number => {
    let id = c.ids.get(e);
    if (id === undefined) {
      id = c.next++;
      c.ids.set(e, id);
    }
    c.nodes.set(id, e);
    return id;
  };
  for (const [id, e] of c.nodes) if (!e.isConnected) c.nodes.delete(id);

  const safe = (e: Element) =>
    !["password", "file", "hidden"].includes((e as HTMLInputElement).type);
  const visible = (e: Element) =>
    !e.closest('[aria-hidden="true"],[inert]') &&
    e.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
  const name = (e: Element | null, seen = new Set<Element>()): string => {
    if (!e || seen.has(e)) return "";
    seen.add(e);
    const input = e as HTMLInputElement;
    const referenced = (e.getAttribute("aria-labelledby") ?? "")
      .split(/\s+/)
      .map((id) => name(document.getElementById(id), seen))
      .filter(Boolean)
      .join(" ");
    const raw =
      referenced ||
      e.getAttribute("aria-label") ||
      [...(input.labels ?? [])]
        .map((l) => name(l, seen))
        .filter(Boolean)
        .join(" ") ||
      (["button", "submit", "reset"].includes(input.type) && e.tagName === "INPUT"
        ? input.value
        : "") ||
      e.getAttribute("alt") ||
      (e.tagName === "INPUT"
        ? ""
        : [...e.childNodes]
            .map((n) =>
              n.nodeType === 3
                ? (n.textContent ?? "")
                : n.nodeType === 1 && (n as Element).getAttribute("aria-hidden") !== "true"
                  ? name(n as Element, seen)
                  : "",
            )
            .join(" ")) ||
      e.getAttribute("title") ||
      e.getAttribute("placeholder") ||
      "";
    return raw.replace(/\s+/g, " ").trim();
  };
  const roles = [
    "button",
    "link",
    "checkbox",
    "radio",
    "switch",
    "tab",
    "menuitem",
    "menuitemradio",
    "option",
    "gridcell",
    "combobox",
    "textbox",
    "searchbox",
    "spinbutton",
  ];
  const selector = `a[href],button,input,textarea,select,summary,[contenteditable="true"],${roles
    .map((r) => `[role="${r}"]`)
    .join(",")}`;
  const role = (e: Element): string | null => {
    const explicit = e.getAttribute("role");
    if (explicit && roles.includes(explicit)) return explicit;
    if (e.tagName === "BUTTON" || e.tagName === "SUMMARY") return "button";
    if (e.tagName === "A") return "link";
    if (e.tagName === "SELECT") return "combobox";
    if (e.tagName === "TEXTAREA" || (e as HTMLElement).isContentEditable) return "textbox";
    if (e.tagName === "INPUT") {
      const t = (e as HTMLInputElement).type;
      if (t === "checkbox" || t === "radio") return t;
      if (["button", "submit", "reset", "image"].includes(t)) return "button";
      if (t === "search") return "searchbox";
      if (t === "number") return "spinbutton";
      if (["text", "email", "url", "tel"].includes(t)) return "textbox";
    }
    return null;
  };
  c.guard = (e) => {
    if (!e?.isConnected || !visible(e)) return null;
    const f = e as HTMLInputElement;
    const scope =
      e.closest('form,dialog,[role="dialog"],article,li,tr,[role="row"]') ?? e.parentElement;
    return JSON.stringify([
      identity(e),
      role(e),
      name(e),
      f.value ?? null,
      f.checked ?? null,
      (e as HTMLSelectElement).selectedIndex ?? null,
      f.readOnly ?? null,
      e.matches(":disabled"),
      e.getAttribute("aria-disabled"),
      e.getAttribute("aria-expanded"),
      e.getAttribute("aria-checked"),
      e.getAttribute("aria-selected"),
      e.getAttribute("href"),
      (scope as HTMLElement | null)?.innerText?.slice(0, 6000) ?? "",
    ]);
  };

  // Enter may be pressed only in a single-line text control that looks like
  // search. Enter in a chat, comment or message box means *send*, and such a
  // label carries no risky word for the daemon's gate to catch.
  const SEARCHY = /\b(search|query|find)\b/i;
  c.submittable = (e) => {
    if (!e?.isConnected || e.tagName === "TEXTAREA" || (e as HTMLElement).isContentEditable)
      return false;
    const input = e as HTMLInputElement;
    const explicit = e.getAttribute("role");
    const single =
      (e.tagName === "INPUT" && ["text", "search", "url", "email", "tel"].includes(input.type)) ||
      explicit === "searchbox" ||
      explicit === "combobox";
    if (!single || input.type === "password") return false;
    const nm = e.getAttribute("name") ?? "";
    return (
      input.type === "search" ||
      explicit === "searchbox" ||
      e.closest('form[role="search"],search,[role="search"]') !== null ||
      ["q", "query", "search"].includes(nm.toLowerCase()) ||
      [name(e), e.getAttribute("placeholder"), e.getAttribute("aria-label"), nm].some(
        (t) => t !== null && SEARCHY.test(t),
      )
    );
  };

  const actions: Action[] = [];
  for (const e of document.querySelectorAll(selector)) {
    if (!safe(e) || !visible(e) || e.matches(":disabled") || e.closest('[aria-disabled="true"]'))
      continue;
    const r = e.getBoundingClientRect();
    const x = r.x + r.width / 2;
    const y = r.y + r.height / 2;
    const rname = role(e);
    if (
      !rname ||
      r.width <= 0 ||
      r.height <= 0 ||
      x < 0 ||
      y < 0 ||
      x >= innerWidth ||
      y >= innerHeight
    )
      continue;
    if (rname === "gridcell" && e.querySelector('button,[role="button"]')) continue;
    const base: Action = { kind: "click", node: identity(e), role: rname, label: name(e) || rname };
    for (const key of ["checked", "selected", "expanded"] as const) {
      const v = e.getAttribute(`aria-${key}`);
      if (v !== null) base[key] = v;
    }
    const input = e as HTMLInputElement;
    if (input.type === "checkbox" || input.type === "radio") base.checked = String(input.checked);
    if (e instanceof HTMLSelectElement) {
      const current = [...e.selectedOptions].map((o) => o.label).join(", ");
      for (const o of e.options) {
        if (o.selected || o.disabled || o.closest("optgroup[disabled]")) continue;
        actions.push({
          ...base,
          kind: "select",
          value: o.value,
          current_value: current,
          label: `${base.label} → ${o.label}`,
        });
      }
      continue;
    }
    const editable =
      !input.readOnly &&
      e.getAttribute("aria-readonly") !== "true" &&
      (["textbox", "searchbox", "spinbutton"].includes(rname) ||
        (rname === "combobox" && ["INPUT", "TEXTAREA"].includes(e.tagName)));
    const value =
      "value" in e
        ? String(input.value)
        : (e as HTMLElement).isContentEditable || rname === "combobox"
          ? (e as HTMLElement).innerText.trim()
          : "";
    actions.push({
      ...base,
      kind: editable ? "fill" : "click",
      value,
      ...(editable && c.submittable(e) ? { submit: true } : {}),
    });
    if (editable) actions.push({ ...base, kind: "click", value, label: `Open ${base.label}` });
  }

  const words: string[] = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let length = 0;
  for (let n = walker.nextNode(); n && length < 6000; n = walker.nextNode()) {
    const value = (n.textContent ?? "").trim();
    const parent = n.parentElement;
    if (!value || !parent || parent.closest("script,style,noscript,template") || !visible(parent))
      continue;
    range.selectNodeContents(n);
    const r = range.getBoundingClientRect();
    if (
      r.width > 0 &&
      r.height > 0 &&
      r.bottom > 0 &&
      r.top < innerHeight &&
      r.right > 0 &&
      r.left < innerWidth
    ) {
      words.push(value);
      length += value.length;
    }
  }

  c.guards = {};
  for (const a of actions) {
    if (a.node !== undefined && !(a.node in c.guards))
      c.guards[a.node] = c.guard(c.nodes.get(a.node)) ?? "";
  }
  actions.splice(250);
  actions.forEach((a, i) => {
    a.id = `e${i + 1}`;
  });
  const height = document.documentElement.scrollHeight;
  if (scrollY + innerHeight < height - 2) {
    actions.push({ id: "scroll_down", kind: "scroll", label: "Scroll down", delta: 560 });
  }
  if (scrollY > 0)
    actions.push({ id: "scroll_up", kind: "scroll", label: "Scroll up", delta: -560 });
  actions.push({ id: "wait", kind: "wait", label: "Wait for the page to update" });
  return {
    url: location.href,
    title: document.title,
    text: words.join("\n").slice(0, 6000),
    visible: document.visibilityState === "visible",
    actions,
  };
}

/** Is `node` still the element Jev saw at the last snapshot? */
export function jevCheck(node: number): string {
  const cache = (window as unknown as Record<symbol, JevCache | undefined>)[
    Symbol.for("reins.jev")
  ];
  const el = cache?.nodes.get(node);
  if (!cache || !el?.isConnected) return "the element is gone";
  const now = cache.guard(el);
  if (now === null) return "the element is hidden now";
  return now === cache.guards[node] ? "ok" : "the element changed since the page was read";
}

/** Focus the field Jev chose to submit, once it still qualifies for Enter. */
export function jevSubmitFocus(node: number): string {
  const cache = (window as unknown as Record<symbol, JevCache | undefined>)[
    Symbol.for("reins.jev")
  ];
  const el = cache?.nodes.get(node);
  if (!cache || !el?.isConnected) return "the field is gone";
  if (!cache.submittable(el)) return "the field is not a search field";
  (el as HTMLElement).focus();
  return document.activeElement === el ? "ok" : "the field would not take focus";
}

/** Choose `value` on a native <select> the way a user's pick would. */
export function jevSelect(node: number, value: string): string {
  const cache = (window as unknown as Record<symbol, JevCache | undefined>)[
    Symbol.for("reins.jev")
  ];
  const el = cache?.nodes.get(node);
  if (!(el instanceof HTMLSelectElement) || !el.isConnected) return "the dropdown is gone";
  const option = [...el.options].find(
    (o) => o.value === value && !o.disabled && !o.closest("optgroup[disabled]"),
  );
  if (!option) return "that option is gone";
  el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return "ok";
}

/**
 * After input: wait two animation frames (≤ 50 ms), or for a typed combobox
 * up to 200 ms until a visible option appears — so the next read sees the
 * suggestions instead of a half-open popup.
 */
export function jevSettle(node: number | null, typed: boolean): Promise<void> {
  const cache = (window as unknown as Record<symbol, JevCache | undefined>)[
    Symbol.for("reins.jev")
  ];
  const field = node === null ? undefined : cache?.nodes.get(node);
  const combobox = typed && field?.getAttribute("role") === "combobox";
  return new Promise((resolve) => {
    let frames = 0;
    let stopped = false;
    const finish = () => {
      stopped = true;
      resolve();
    };
    setTimeout(finish, combobox ? 200 : 50);
    const ready = () => {
      if (stopped) return;
      const ids = (field?.getAttribute("aria-controls") || field?.getAttribute("aria-owns") || "")
        .split(/\s+/)
        .filter(Boolean);
      const roots: ParentNode[] = ids.length
        ? ids.map((id) => document.getElementById(id)).filter((e): e is HTMLElement => e !== null)
        : [document];
      const options = roots.flatMap((root) => [...root.querySelectorAll('[role="option"]')]);
      frames += 1;
      const shown = options.some((e) => {
        const r = e.getBoundingClientRect();
        return (
          r.width > 0 &&
          r.height > 0 &&
          r.bottom > 0 &&
          r.top < innerHeight &&
          e.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
        );
      });
      if (frames >= 2 && (!combobox || shown)) finish();
      else requestAnimationFrame(ready);
    };
    requestAnimationFrame(ready);
  });
}
