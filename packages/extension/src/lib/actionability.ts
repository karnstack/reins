/**
 * Page-side checks that run before (and after) trusted pointer input.
 *
 * These functions execute *inside the page* via Runtime.evaluate — they are
 * serialized with Function.prototype.toString, so they must stay
 * self-contained: no imports, no references to anything in module scope.
 */

/** Where to put the pointer, or why there's nowhere safe to put it. */
export type ActionPoint = { x: number; y: number } | { error: string };

/** What the armed pointer probe saw; null when the page navigated away. */
export type ProbeResult = { state: "hit" } | { state: "none" } | { state: "missed"; by: string };

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
 */
export async function actionPoint(
  selector: string,
  timeoutMs: number,
  forClick: boolean,
): Promise<ActionPoint> {
  const describe = (n: Element | null): string => {
    if (!n) return "nothing (the point is outside the viewport)";
    let s = n.tagName.toLowerCase();
    if (n.id) return `${s}#${n.id}`;
    const cls = typeof n.className === "string" ? n.className.trim().split(/\s+/) : [];
    if (cls[0]) s += `.${cls.slice(0, 2).join(".")}`;
    return s;
  };
  const deadline = performance.now() + timeoutMs;
  // The element's rect, read in the next animation frame. rAF never fires in
  // a hidden tab, so a timeout stands in for it there.
  const nextFrame = (el: Element) =>
    new Promise<{ t: number; r: DOMRect }>((resolve) => {
      let done = false;
      const read = (t: number) => {
        if (done) return;
        done = true;
        resolve({ t, r: el.getBoundingClientRect() });
      };
      requestAnimationFrame(read);
      setTimeout(() => read(performance.now()), 100);
    });
  // Wait for the rect to hold still across two distinct frames; null if it
  // never does before the deadline.
  // A just-started CSS animation or transition is "pending": held at its first
  // keyframe until its start time resolves, it reads identical across frames
  // and would pass for still. Covers ancestors too — their transforms move us.
  const starting = (el: Element) => {
    for (let n: Element | null = el; n; n = n.parentElement) {
      if (n.getAnimations().some((a) => a.pending)) return true;
    }
    return false;
  };
  const settle = async (el: Element): Promise<DOMRect | null> => {
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
      if (still && !starting(el)) return b;
      if (performance.now() >= deadline) return null;
      prev = cur;
    }
  };
  let reason = "";
  for (let first = true; ; first = false) {
    // Re-query every attempt: frameworks may swap the node while we wait.
    const el = document.querySelector(selector);
    if (!el) {
      if (first) return { error: "notfound" };
      reason = "element was removed from the page";
    } else {
      el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
      const r = await settle(el);
      if (!r) {
        reason = "element is still moving (scrolling or animating)";
      } else if (r.width === 0 || r.height === 0) {
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
        if (n === el) {
          if (forClick) {
            const state: { result: ProbeResult } = { result: { state: "none" } };
            const onDown = (e: Event) => {
              const at = e.composedPath()[0];
              state.result = e.composedPath().includes(el)
                ? { state: "hit" }
                : { state: "missed", by: describe(at instanceof Element ? at : null) };
            };
            window.addEventListener("pointerdown", onDown, { capture: true, once: true });
            (window as unknown as Record<symbol, unknown>)[Symbol.for("reins.pointerProbe")] = {
              state,
              cancel: () => window.removeEventListener("pointerdown", onDown, true),
            };
          }
          return { x, y };
        }
        reason = `covered by ${describe(hit)}`;
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
