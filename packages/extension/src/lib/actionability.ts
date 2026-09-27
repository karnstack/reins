/**
 * Page-side checks that run before (and after) trusted pointer input.
 *
 * These functions execute *inside the page* via Runtime.evaluate — they are
 * serialized with Function.prototype.toString, so they must stay
 * self-contained: no imports, no references to anything in module scope.
 */

/** Where to put the pointer, or why there's nowhere safe to put it. */
export type ActionPoint = { x: number; y: number } | { error: string };

/**
 * What the armed pointer probe saw; null when the page navigated away.
 * `newTabUrl`: the press activated a link to a new tab, whose own navigation
 * the probe cancelled — the caller opens this URL in a tab itself.
 */
export type ProbeResult = (
  | { state: "hit" }
  | { state: "none" }
  | { state: "missed"; by: string }
) & { newTabUrl?: string };

/**
 * Scroll `selector` into view, wait until it stops moving, and confirm a
 * pointer at its center would land on it (not on an overlay, a sticky header,
 * or empty space). Retries until `timeoutMs`, then reports the last reason.
 *
 * Coordinates read mid-scroll or mid-animation are stale by the time input
 * arrives — `scroll-behavior: smooth` alone sends a click hundreds of pixels
 * off target — so the rect must hold still across a frame before it counts.
 *
 * With `forClick`, the element must also be enabled — a disabled control
 * still receives the press, so the click would "land" and do nothing — and a
 * one-shot capture listener is armed recording whether the next pointerdown
 * reaches the element; read it back with `readProbe`.
 *
 * With `node`, the target is the Jev node cache entry (`reins do` observed it
 * by id); `selector` then only names it in messages.
 *
 * A click target inside an `<a href target=_blank>` (or any link whose
 * effective target, including a `<base target>`, names no frame of this page)
 * also gets a click interceptor: Chrome answers a trusted click on such a
 * link with a foreground tab *and* activates itself over whatever app the
 * user is working in (a ⌘/Ctrl-click only moves the tab behind; the window
 * is still raised). The interceptor, last in line on `window` so the page's
 * own handlers run first and see an ordinary click, cancels the link's
 * navigation and records its resolved href in the probe; the extension then
 * opens that URL with chrome.tabs.create, which raises nothing. A page that
 * stops the click's propagation keeps Chrome's own behaviour, and links a
 * page opens from script (window.open in a handler) are out of this sight.
 */
export async function actionPoint(
  selector: string,
  timeoutMs: number,
  forClick: boolean,
  node: number | null = null,
): Promise<ActionPoint> {
  // A Jev node id points at the exact element reins do observed; otherwise
  // the CSS selector is re-queried (frameworks may swap nodes while we wait).
  const find = (): Element | null => {
    if (node === null) return document.querySelector(selector);
    const cache = (
      window as unknown as Record<symbol, { nodes?: Map<number, Element> } | undefined>
    )[Symbol.for("reins.jev")];
    const el = cache?.nodes?.get(node);
    return el?.isConnected ? el : null;
  };
  const describe = (n: Element | null): string => {
    if (!n) return "nothing (the point is outside the viewport)";
    let s = n.tagName.toLowerCase();
    if (n.id) return `${s}#${n.id}`;
    const cls = typeof n.className === "string" ? n.className.trim().split(/\s+/) : [];
    if (cls[0]) s += `.${cls.slice(0, 2).join(".")}`;
    return s;
  };
  // The link a click on `el` activates, if any: the nearest enclosing <a>/<area>
  // with an href, looked up through shadow hosts (closest() stops at a root).
  const enclosingLink = (start: Element): Element | null => {
    for (let n: Node | null = start; n; ) {
      if (n instanceof Element && /^(a|area)$/.test(n.localName) && n.hasAttribute("href")) {
        return n;
      }
      n = n.parentNode ?? (n instanceof ShadowRoot ? n.host : null);
    }
    return null;
  };
  // Does activating this link open a new browsing context? Its target (or the
  // document's <base target>) is neither a self/ancestor keyword nor the name
  // of a frame in this document. A download link never opens a tab.
  const opensNewTab = (link: Element): boolean => {
    if (link.hasAttribute("download")) return false;
    const target = (
      link.getAttribute("target") ??
      document.querySelector("base[target]")?.getAttribute("target") ??
      ""
    ).trim();
    if (target === "" || /^_(self|parent|top)$/i.test(target)) return false;
    if (target.toLowerCase() === "_blank") return true;
    for (const f of document.querySelectorAll("iframe[name], frame[name]")) {
      if (f.getAttribute("name") === target) return false;
    }
    return true;
  };
  const deadline = performance.now() + timeoutMs;
  // The element's rect, read in the next animation frame. rAF never fires in
  // a hidden tab, so a timer stands in for it there — and only there. In a
  // visible tab the animation clock is frozen between frames: a timer-task
  // read repeats the last frame's rect while the compositor keeps moving the
  // element, and that false "still" would send the press to where the
  // element was. So a visible tab waits for the frame, until the deadline.
  const nextFrame = (el: Element) =>
    new Promise<{ t: number; r: DOMRect }>((resolve) => {
      let done = false;
      const read = (t: number) => {
        if (done) return;
        done = true;
        resolve({ t, r: el.getBoundingClientRect() });
      };
      requestAnimationFrame(read);
      const fallback = () => {
        if (done) return;
        if (document.visibilityState !== "visible" || performance.now() >= deadline) {
          read(performance.now());
        } else {
          setTimeout(fallback, 100);
        }
      };
      setTimeout(fallback, 100);
    });
  // A just-started CSS animation or transition is "pending": held at its first
  // keyframe until its start time resolves, it reads identical across frames
  // and would pass for still. Covers ancestors too — their transforms move us.
  const starting = (el: Element) => {
    for (let n: Element | null = el; n; n = n.parentElement) {
      if (n.getAnimations().some((a) => a.pending)) return true;
    }
    return false;
  };
  // Wait for the rect to hold still across two distinct frames. At the
  // deadline, hand back the latest rect anyway, flagged as still moving.
  const settle = async (el: Element): Promise<{ r: DOMRect; still: boolean }> => {
    let prev = await nextFrame(el);
    for (;;) {
      const cur = await nextFrame(el);
      const a = prev.r;
      const b = cur.r;
      const still =
        cur.t !== prev.t &&
        a.x === b.x &&
        a.y === b.y &&
        a.width === b.width &&
        a.height === b.height;
      if (still && !starting(el)) return { r: b, still: true };
      if (performance.now() >= deadline) return { r: b, still: false };
      prev = cur;
    }
  };
  let reason = "";
  for (let first = true; ; first = false) {
    // Re-query every attempt: frameworks may swap the node while we wait.
    const el = find();
    if (!el) {
      if (first) return { error: "notfound" };
      reason = "element was removed from the page";
    } else {
      el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
      // An element that never settles (a pulsing call-to-action, an endless
      // animation) still gets clicked at the deadline if its current center
      // hits it — settle only returns unsettled once the deadline has passed.
      const { r, still } = await settle(el);
      if (r.width === 0 || r.height === 0) {
        reason = "element has zero size (hidden?)";
      } else if (forClick && (el.matches(":disabled") || el.closest('[aria-disabled="true"]'))) {
        reason = "element is disabled";
      } else {
        const x = r.x + r.width / 2;
        const y = r.y + r.height / 2;
        let hit = document.elementFromPoint(x, y);
        while (hit?.shadowRoot) {
          const inner = hit.shadowRoot.elementFromPoint(x, y);
          if (!inner || inner === hit) break;
          hit = inner;
        }
        let n: Node | null = hit;
        while (n && n !== el) n = n.parentNode ?? (n instanceof ShadowRoot ? n.host : null);
        // A press into a frame lands in the frame's own document, out of this
        // window's sight — so frames get no probe.
        const frame = /^(iframe|frame|object|embed)$/.test(el.localName);
        if (n === el) {
          if (forClick && !frame) {
            const state: { result: ProbeResult } = { result: { state: "none" } };
            const onDown = (e: Event) => {
              const at = e.composedPath()[0];
              // Frameworks re-mount nodes on hover; the element the selector
              // finds now counts as the target too.
              const now = find();
              const path = e.composedPath();
              state.result =
                path.includes(el) || (now !== null && path.includes(now))
                  ? { state: "hit" }
                  : { state: "missed", by: describe(at instanceof Element ? at : null) };
            };
            window.addEventListener("pointerdown", onDown, { capture: true, once: true });
            const link = enclosingLink(el);
            const onClick =
              link && opensNewTab(link)
                ? (e: Event) => {
                    // Only the click that activates this link; one the page
                    // already cancelled is its own to handle.
                    const me = e as MouseEvent;
                    if (me.button !== 0 || me.defaultPrevented) return;
                    if (!e.composedPath().includes(link)) return;
                    e.preventDefault();
                    const { href } = link as { href?: unknown }; // an SVG <a> has an animated one
                    state.result.newTabUrl =
                      typeof href === "string"
                        ? href
                        : new URL(link.getAttribute("href") ?? "", document.baseURI).href;
                  }
                : null;
            if (onClick) window.addEventListener("click", onClick);
            (window as unknown as Record<symbol, unknown>)[Symbol.for("reins.pointerProbe")] = {
              state,
              cancel: () => {
                window.removeEventListener("pointerdown", onDown, true);
                if (onClick) window.removeEventListener("click", onClick);
              },
            };
          }
          return { x, y };
        }
        reason = still
          ? `covered by ${describe(hit)}`
          : "element is still moving (scrolling or animating)";
      }
    }
    if (performance.now() >= deadline) return { error: reason };
    await new Promise((r) => setTimeout(r, 100));
  }
}

/** Collect (and disarm) the probe `actionPoint` armed; null if it's gone. */
export function readProbe(): ProbeResult | null {
  const key = Symbol.for("reins.pointerProbe");
  const w = window as unknown as Record<symbol, unknown>;
  const probe = w[key] as { state: { result: ProbeResult }; cancel: () => void } | undefined;
  if (!probe) return null;
  probe.cancel();
  delete w[key];
  return probe.state.result;
}
