/**
 * `reins snapshot`'s page half. Runs *inside the page* via Runtime.evaluate,
 * serialized with Function.prototype.toString, so it stays self-contained:
 * the shared DOM helpers come in as the `dom` argument (see pageDom).
 */

import type { pageDom } from "./page-dom.js";

export interface StepSnapshot {
  content: string;
  refs: Array<{ ref: string; role: string; name: string }>;
}

/**
 * Tag interactive and heading elements with `data-reins-ref="e#"` and list
 * them. Elements inside open shadow roots are listed and tagged too (a site's
 * search button or menu built as a web component); closed roots stay out of
 * reach. Names are composed the way `reins do` reads them: aria-labelledby,
 * aria-label, labels, then rendered text through shadow roots and slots.
 */
export function stepSnapshot(dom: typeof pageDom): StepSnapshot {
  const { name, collect } = dom();
  const ATTR = "data-reins-ref";
  // A ref names exactly one element, so the last snapshot's tags come off
  // first. An element hidden since (the wizard step just left, the tab panel
  // just switched away from) would otherwise keep a ref this snapshot hands to
  // another element, and `--ref` would find the hidden one first.
  for (const el of collect(`[${ATTR}]`)) el.removeAttribute(ATTR);
  const refs: StepSnapshot["refs"] = [];
  let n = 0;
  const sel = 'a,button,input,textarea,select,[role],h1,h2,h3,[contenteditable="true"]';
  for (const el of collect(sel)) {
    if (!(el instanceof HTMLElement) || !el.checkVisibility({ checkVisibilityCSS: true })) continue;
    const ref = `e${++n}`;
    el.setAttribute(ATTR, ref);
    const role = el.getAttribute("role") || el.tagName.toLowerCase();
    refs.push({ ref, role, name: name(el, 80).slice(0, 80) });
  }
  const content = refs.map((r) => `${r.ref}: ${r.role} ${JSON.stringify(r.name)}`).join("\n");
  return { content, refs };
}
