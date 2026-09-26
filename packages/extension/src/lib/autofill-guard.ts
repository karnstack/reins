/**
 * Keep password-manager autofill menus from locking reins out of a tab.
 *
 * 1Password, Bitwarden, Dashlane, … draw their inline menu as a
 * chrome-extension:// iframe (often inside a closed shadow root). Chrome
 * refuses chrome.debugger on any tab holding another extension's frame: the
 * live session is dropped and every later attach fails with "Cannot access a
 * chrome-extension:// URL of different extension" — so focusing one form field
 * would end all driving of that tab.
 *
 * Each reins command renews a lease; while it's live, this removes those hosts
 * as they appear. Once the agent goes idle the lease lapses, the guard stands
 * down, and the user's password manager works in that tab again.
 *
 * Runs *inside the page* via Runtime.evaluate — serialized with
 * Function.prototype.toString, so it must stay self-contained.
 */
export function autofillGuard(leaseMs: number): void {
  type Guard = { until: number; stop?: () => void };
  const key = Symbol.for("reins.autofillGuard");
  const w = window as unknown as Record<symbol, Guard | undefined>;
  const until = Date.now() + leaseMs;
  const live = w[key];
  if (live?.stop) {
    live.until = until;
    return;
  }
  const guard: Guard = { until };
  w[key] = guard;

  const HOST =
    /^(com-1password|op-1password|onepassword|com-dashlane|dashlanify|com-lastpass|lastpass-|com-bitwarden|bitwarden-|keeper-|com-keeper|proton-pass|com-roboform)/;
  const offends = (el: Element) =>
    HOST.test(el.localName) ||
    (el.localName === "iframe" && (el.getAttribute("src") ?? "").startsWith("chrome-extension://"));
  // Walk the document and every open shadow root. A closed shadow root hides
  // its iframe, but the host element itself matches HOST. Rooted at `document`
  // because on a new document this runs before <html> exists.
  const sweep = () => {
    const stack: Array<Document | Element | ShadowRoot> = [document];
    while (stack.length) {
      const node = stack.pop();
      if (!node) continue;
      for (const el of Array.from(node.children)) {
        if (offends(el)) {
          el.remove();
          continue;
        }
        stack.push(el);
        if (el.shadowRoot) stack.push(el.shadowRoot);
      }
    }
  };
  const observer = new MutationObserver((records) => {
    if (Date.now() > guard.until) return guard.stop?.();
    for (const r of records) {
      for (const n of Array.from(r.addedNodes)) {
        if (n instanceof Element && offends(n)) n.remove();
      }
    }
  });
  // The periodic sweep catches hosts built where the observer can't see.
  const timer = setInterval(() => {
    if (Date.now() > guard.until) guard.stop?.();
    else sweep();
  }, 250);
  guard.stop = () => {
    clearInterval(timer);
    observer.disconnect();
    if (w[key] === guard) delete w[key];
  };
  observer.observe(document, { childList: true, subtree: true });
  sweep();
}
