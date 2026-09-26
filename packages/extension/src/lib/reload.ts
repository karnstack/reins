/**
 * Reload this extension from disk — the dev loop's "⟳ Reload" click.
 *
 * Only meaningful for an unpacked build (a source checkout, or the sideload
 * `reins extension` stages): Chrome re-reads its files. A Chrome Web Store
 * install updates itself; reloading it would only drop the connection.
 */
export async function reloadExtension(): Promise<{ reloading: true; version: string }> {
  const self = await chrome.management.getSelf();
  if (self.installType !== "development") {
    const kind = self.installType === "normal" ? "Chrome Web Store" : self.installType;
    throw new Error(
      `extension reload is for unpacked builds (a dev checkout or the \`reins extension\` sideload) — this browser runs the ${kind} build, which updates itself`,
    );
  }
  // Answer first: reloading tears down this service worker and the bridge.
  setTimeout(() => chrome.runtime.reload(), 200);
  return { reloading: true, version: self.version };
}
