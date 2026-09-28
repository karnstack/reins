/**
 * Page-side DOM helpers shared by `reins snapshot` and `reins do`'s
 * observation. Like every page function here, these run *inside the page* via
 * Runtime.evaluate, serialized with Function.prototype.toString, so they stay
 * self-contained: no imports, no references to module scope. A page function
 * that needs them takes `pageDom` itself as an argument —
 * `(${stepSnapshot})(${pageDom})` — and calls it for the helpers.
 *
 * Shadow DOM: what an open shadow root renders is part of the page a person
 * sees (a site's search box or dialog built as a web component), so elements
 * and text are collected through open roots, recursively, and ancestor walks
 * cross the boundary through the host. A closed root cannot be reached from
 * the page and stays invisible.
 */
export function pageDom() {
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
  /** Every element matching `selector` in document order, descending into
   *  open shadow roots where their hosts sit. */
  const collect = (selector: string): Element[] => {
    const out: Element[] = [];
    const walk = (root: Node): void => {
      const tw = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
      for (let n = tw.nextNode(); n; n = tw.nextNode()) {
        const e = n as Element;
        if (e.matches(selector)) out.push(e);
        if (e.shadowRoot) walk(e.shadowRoot);
      }
    };
    walk(document.documentElement);
    return out;
  };
  const label = (e: Element | null, max: number, seen: Set<Element>): string => {
    if (!e || seen.has(e)) return "";
    seen.add(e);
    const input = e as HTMLInputElement;
    const referenced = (e.getAttribute("aria-labelledby") ?? "")
      .split(/\s+/)
      .map((id) => label(byId(e, id), max, seen))
      .filter(Boolean)
      .join(" ");
    // A select's options are not its name. Text is read through open shadow
    // roots and slots, so a web-component option or button whose words sit in
    // its own root (or come in through a slot) is named. Reading stops once
    // `max` characters are in: a big container is not walked to the end.
    const text = (): string => {
      if (e.tagName === "INPUT" || e.tagName === "SELECT") return "";
      let out = "";
      for (const n of rendered(e)) {
        if (out.length > max) break;
        out += ` ${
          n.nodeType === 3
            ? (n.textContent ?? "")
            : n.nodeType === 1 && (n as Element).getAttribute("aria-hidden") !== "true"
              ? label(n as Element, max, seen)
              : ""
        }`;
      }
      return out;
    };
    const raw =
      referenced ||
      e.getAttribute("aria-label") ||
      [...(input.labels ?? [])]
        .map((l) => label(l, max, seen))
        .filter(Boolean)
        .join(" ") ||
      (["button", "submit", "reset"].includes(input.type) && e.tagName === "INPUT"
        ? input.value
        : "") ||
      e.getAttribute("alt") ||
      text() ||
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
  /** An element's accessible name, composed through open shadow roots and
   *  slots. `max` bounds how much text is read (the name may run past it). */
  const name = (e: Element | null, max = Number.POSITIVE_INFINITY): string =>
    label(e, max, new Set());
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
  return { parentOf, ancestor, byId, visible, rendered, collect, name };
}

/** The helpers `pageDom` hands a page function. */
export type PageDom = ReturnType<typeof pageDom>;

/**
 * The element `reins snapshot` tagged with `ref`, searched through open
 * shadow roots (the snapshot tags elements there too); null when none has it.
 */
export function findRef(ref: string): Element | null {
  const search = (root: Node): Element | null => {
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    for (let n = tw.nextNode(); n; n = tw.nextNode()) {
      const e = n as Element;
      if (e.getAttribute("data-reins-ref") === ref) return e;
      const inner = e.shadowRoot ? search(e.shadowRoot) : null;
      if (inner) return inner;
    }
    return null;
  };
  return search(document.documentElement);
}
