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
  // A new document registered after its lease lapsed: nothing to guard.
  if (leaseMs <= 0) return;
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
  const EXTENSION_FRAMES = 'iframe[src^="chrome-extension:"]';
  // Walk the document and every open shadow root, once, when the guard comes
  // up. A closed shadow root hides its iframe, but the host element itself
  // matches HOST. Rooted at `document` because on a new document this runs
  // before <html> exists.
  const fullSweep = () => {
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
  // After that, keep it cheap — a full walk every tick is a long task on a
  // big page. Password managers mount their hosts at the top of the page,
  // and a native query finds extension frames anywhere in the light DOM.
  const quickSweep = () => {
    for (const root of [document.documentElement, document.body]) {
      if (!root) continue;
      for (const el of Array.from(root.children)) if (offends(el)) el.remove();
    }
    for (const f of Array.from(document.querySelectorAll(EXTENSION_FRAMES))) f.remove();
  };
  const observer = new MutationObserver((records) => {
    if (Date.now() > guard.until) return guard.stop?.();
    for (const r of records) {
      for (const n of Array.from(r.addedNodes)) {
        if (!(n instanceof Element)) continue;
        if (offends(n)) n.remove();
        else if (n.firstElementChild) {
          for (const f of Array.from(n.querySelectorAll(EXTENSION_FRAMES))) f.remove();
        }
      }
    }
  });
  // The periodic sweep catches frames built where the observer can't see
  // (inside a host that was already on the page).
  const timer = setInterval(() => {
    if (Date.now() > guard.until) guard.stop?.();
    else quickSweep();
  }, 250);
  guard.stop = () => {
    clearInterval(timer);
    observer.disconnect();
    if (w[key] === guard) delete w[key];
  };
  observer.observe(document, { childList: true, subtree: true });
  fullSweep();
}
