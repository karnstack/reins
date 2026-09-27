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

  // Shadow DOM: what an open shadow root renders is part of the page a
  // person sees (a site's search box or dialog built as a web component), so
  // controls and text are collected through open roots, recursively, and
  // ancestor walks cross the boundary through the host. A closed root cannot
  // be reached from the page and stays invisible.
  const parentOf = (n: Node): Element | null => {
    const p = n.parentNode;
    if (!p) return null;
    if (p instanceof ShadowRoot) return p.host;
    return p.nodeType === 1 ? (p as Element) : null;
  };
  /** `closest`, crossing shadow boundaries. */
  const ancestor = (e: Element, sel: string): Element | null => {
    for (let p: Element | null = e; p; p = parentOf(p)) if (p.matches(sel)) return p;
    return null;
  };
  /** The element with `id` in the tree `e` belongs to (a shadow root has its own ids). */
  const byId = (e: Element, id: string): Element | null => {
    const root = e.getRootNode();
    return root instanceof Document || root instanceof ShadowRoot ? root.getElementById(id) : null;
  };
  const safe = (e: Element) =>
    !["password", "file", "hidden"].includes((e as HTMLInputElement).type);
  const visible = (e: Element) =>
    !ancestor(e, '[aria-hidden="true"],[inert]') &&
    e.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
  /** What an element renders, the way the accessibility tree reads it: an
   *  open shadow root's children stand in for the host's own (which only
   *  show through slots), and a slot stands for what is assigned to it. */
  const rendered = (e: Element): Node[] => {
    if (e.shadowRoot) return [...e.shadowRoot.childNodes];
    if (e instanceof HTMLSlotElement) return e.assignedNodes({ flatten: true });
    return [...e.childNodes];
  };
  const name = (e: Element | null, seen = new Set<Element>()): string => {
    if (!e || seen.has(e)) return "";
    seen.add(e);
    const input = e as HTMLInputElement;
    const referenced = (e.getAttribute("aria-labelledby") ?? "")
      .split(/\s+/)
      .map((id) => name(byId(e, id), seen))
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
      // A select's options are not its name. Text is read through open
      // shadow roots and slots, so a web-component option or button whose
      // words sit in its own root (or come in through a slot) is named.
      (e.tagName === "INPUT" || e.tagName === "SELECT"
        ? ""
        : rendered(e)
            .map((n) =>
              n.nodeType === 3
                ? (n.textContent ?? "")
                : n.nodeType === 1 && (n as Element).getAttribute("aria-hidden") !== "true"
                  ? name(n as Element, seen)
                  : "",
            )
            .join(" ")) ||
      "";
    const own = raw.replace(/\s+/g, " ").trim();
    if (own) return own;
    // No label of its own: a title or placeholder is a weak name, and a form
    // control gets the row or group it sits in — the first cell of an
    // enclosing table row that is not its own, a fieldset's legend, a
    // labelled group — so "Year" under "Start Date" and "Year" under "End
    // Date" read apart, and an unlabelled select is not just "combobox".
    const weak = (e.getAttribute("title") || e.getAttribute("placeholder") || "")
      .replace(/\s+/g, " ")
      .trim();
    if (!e.matches("input,select,textarea")) return weak;
    const ctx = context(e);
    return ctx ? (weak ? `${ctx}: ${weak}` : ctx) : weak;
  };
  // A cell's own words: what a person reads as the row's label. Controls in
  // the cell (a select's options, a button's caption) are not that label.
  const cellText = (cell: Element): string => {
    let out = "";
    const walk = (n: Node) => {
      if (n.nodeType === 3) out += `${n.textContent ?? ""} `;
      else if (n.nodeType === 1) {
        const el = n as Element;
        if (
          /^(SELECT|INPUT|TEXTAREA|BUTTON|SCRIPT|STYLE)$/.test(el.tagName) ||
          el.getAttribute("aria-hidden") === "true"
        )
          return;
        for (const c of el.childNodes) walk(c);
      }
    };
    walk(cell);
    return out.replace(/\s+/g, " ").trim();
  };
  const context = (e: Element): string => {
    for (let p = parentOf(e); p && p !== document.body; p = parentOf(p)) {
      if (p.tagName === "TR") {
        for (const cell of p.children) {
          if (cell.contains(e)) continue;
          const t = cellText(cell);
          if (t && t.length <= 60) return t;
        }
      } else if (p.tagName === "FIELDSET") {
        const legend = p.querySelector(":scope > legend");
        const t = legend ? name(legend) : "";
        if (t) return t;
      } else if (p.getAttribute("role") === "group") {
        const t = name(p);
        if (t) return t;
      }
    }
    return "";
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
      ancestor(e, 'form,dialog,[role="dialog"],article,li,tr,[role="row"]') ?? parentOf(e);
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

  // A consent banner's "Accept" is not a risky action (the daemon's gate
  // waives it): the button sits in an ancestor that says what it is — an
  // id/class/aria hint, or a dialog/region/banner whose opening text names
  // cookies, consent, privacy, GDPR or tracking. Only labels the gate would
  // stop on are checked; innerText is read for dialog-like ancestors only.
  const CONSENT = /cookie|consent|privacy|gdpr|tracking/i;
  const CONSENT_LABEL = /\b(accept|agree)\b/i;
  const CONTAINER_ROLES = ["dialog", "alertdialog", "region", "banner", "complementary"];
  const inConsent = (e: Element): boolean => {
    for (let p = parentOf(e); p && p !== document.body; p = parentOf(p)) {
      const hint = [
        p.id,
        p.getAttribute("class"),
        p.getAttribute("aria-label"),
        p.getAttribute("data-testid"),
      ]
        .filter(Boolean)
        .join(" ");
      if (CONSENT.test(hint)) return true;
      const container =
        p.tagName === "DIALOG" ||
        p.tagName === "ASIDE" ||
        CONTAINER_ROLES.includes(p.getAttribute("role") ?? "") ||
        p.getAttribute("aria-modal") === "true";
      if (container && CONSENT.test(((p as HTMLElement).innerText ?? "").slice(0, 600)))
        return true;
    }
    return false;
  };

  // Every control in document order, descending into open shadow roots where
  // their hosts sit (so ids stay positional across light and shadow trees).
  const controls: Element[] = [];
  const collect = (root: Node): void => {
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    for (let n = tw.nextNode(); n; n = tw.nextNode()) {
      const e = n as Element;
      if (e.matches(selector)) controls.push(e);
      if (e.shadowRoot) collect(e.shadowRoot);
    }
  };
  collect(document.documentElement);
  const actions: Action[] = [];
  for (const e of controls) {
    if (!safe(e) || !visible(e) || e.matches(":disabled") || ancestor(e, '[aria-disabled="true"]'))
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
    if (CONSENT_LABEL.test(base.label) && inConsent(e)) base.consent = true;
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
  const range = document.createRange();
  let length = 0;
  // Text nodes in document order; an open shadow root's text is read where
  // its host sits, before the host's own (slotted) children.
  const walkText = (root: Node): void => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n && length < 6000; n = walker.nextNode()) {
      if (n.nodeType === 1) {
        const shadow = (n as Element).shadowRoot;
        if (shadow) walkText(shadow);
        continue;
      }
      const value = (n.textContent ?? "").trim();
      const parent = parentOf(n);
      if (
        !value ||
        !parent ||
        ancestor(parent, "script,style,noscript,template") ||
        !visible(parent)
      )
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
  };
  walkText(document.body);

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
/** What a field holds now (null when the node is gone): typing that was cut
 *  short by a dropped debugger session resumes from here. */
export function jevFieldValue(node: number): string | null {
  const cache = (window as unknown as Record<symbol, JevCache | undefined>)[
    Symbol.for("reins.jev")
  ];
  const el = cache?.nodes.get(node);
  if (!el?.isConnected) return null;
  const v = (el as HTMLInputElement).value;
  return typeof v === "string" ? v : (el.textContent ?? "");
}

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
  // A field in a shadow root is the active element of its own root; the
  // document only knows the host.
  const root = el.getRootNode() as Document | ShadowRoot;
  return root.activeElement === el ? "ok" : "the field would not take focus";
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
 * After input: let the page react before the next read. At least two
 * animation frames (≤ 50 ms); for a typed combobox, up to 200 ms until a
 * visible option appears. Then, if the page has started changing (DOM
 * mutations since the input), wait until it has been quiet for 300 ms, so
 * the read sees the reaction (a sort applied, a filter's results, a
 * suggestion list) and not the page mid-change; a page that does not react
 * within 150 ms of the frames is read at once. Capped at 1.5 s from the
 * input, for pages that never stop changing.
 */
export function jevSettle(node: number | null, typed: boolean): Promise<void> {
  const cache = (window as unknown as Record<symbol, JevCache | undefined>)[
    Symbol.for("reins.jev")
  ];
  const field = node === null ? undefined : cache?.nodes.get(node);
  const combobox = typed && field?.getAttribute("role") === "combobox";
  const QUIET_MS = 300;
  const REACT_MS = 150;
  const CAP_MS = 1500;
  return new Promise((resolve) => {
    let frames = 0;
    let stopped = false;
    let mutated = false;
    let quiet: ReturnType<typeof setTimeout> | undefined;
    let react: ReturnType<typeof setTimeout> | undefined;
    const observer = new MutationObserver(() => {
      if (stopped) return;
      mutated = true;
      if (react !== undefined) clearTimeout(react);
      if (quiet !== undefined) clearTimeout(quiet);
      quiet = setTimeout(finish, QUIET_MS);
    });
    const finish = () => {
      if (stopped) return;
      stopped = true;
      observer.disconnect();
      clearTimeout(cap);
      if (quiet !== undefined) clearTimeout(quiet);
      if (react !== undefined) clearTimeout(react);
      resolve();
    };
    const cap = setTimeout(finish, CAP_MS);
    observer.observe(document, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    });
    // The frames are done: a page that has not reacted gets a short grace
    // period for a first change; one that has is read once it goes quiet.
    const framed = () => {
      if (mutated) return; // the quiet timer is already running
      react = setTimeout(finish, REACT_MS);
    };
    const ready = () => {
      if (stopped) return;
      const ids = (field?.getAttribute("aria-controls") || field?.getAttribute("aria-owns") || "")
        .split(/\s+/)
        .filter(Boolean);
      // The ids resolve in the field's own tree (a shadow root has its own).
      const tree = field?.getRootNode();
      const scope = tree instanceof Document || tree instanceof ShadowRoot ? tree : document;
      const roots: ParentNode[] = ids.length
        ? ids.map((id) => scope.getElementById(id)).filter((e): e is HTMLElement => e !== null)
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
      if (frames >= 2 && (!combobox || shown)) framed();
      else if (combobox && performance.now() - t0 >= 200) framed();
      else requestAnimationFrame(ready);
    };
    const t0 = performance.now();
    requestAnimationFrame(ready);
  });
}

/**
 * After Enter in a search field: wait for the submission to take effect, so
 * the next read sees the results and not the page as it was. Resolves once
 * the URL differs from `before` (a router's pushState lands with the results),
 * once DOM changes have started and then stayed quiet for 300 ms, or after
 * 1.5 s at most. A classic form navigation unloads the document instead,
 * which rejects the evaluate; the caller treats that as settled.
 */
export function jevSubmitted(before: string): Promise<void> {
  return new Promise((resolve) => {
    let stopped = false;
    let quiet: ReturnType<typeof setTimeout> | undefined;
    const observer = new MutationObserver(() => {
      if (stopped) return;
      if (quiet !== undefined) clearTimeout(quiet);
      quiet = setTimeout(finish, 300);
    });
    const finish = () => {
      if (stopped) return;
      stopped = true;
      observer.disconnect();
      clearInterval(poll);
      clearTimeout(cap);
      if (quiet !== undefined) clearTimeout(quiet);
      resolve();
    };
    const cap = setTimeout(finish, 1500);
    const poll = setInterval(() => {
      if (location.href !== before) finish();
    }, 50);
    observer.observe(document, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    });
    if (location.href !== before) finish();
  });
}
