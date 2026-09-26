import type { BrowserInfo } from "@reins/protocol";

export interface ReloadDeps {
  rpc(method: string, params: Record<string, unknown>): Promise<unknown>;
  /** Resolve with the first browser that connects after `since` (epoch ms). */
  waitReconnect(since: number): Promise<BrowserInfo>;
}

/**
 * `reins extension --reload`: have a connected unpacked build reload itself
 * from disk, then wait for it to reconnect. The extension refuses on a Chrome
 * Web Store build — that error passes straight through.
 */
export async function reloadExtension(
  deps: ReloadDeps,
  route: { browserId?: string },
): Promise<string> {
  const since = Date.now();
  const { version } = (await deps.rpc("extension_reload", { ...route })) as { version: string };
  const b = await deps.waitReconnect(since).catch(() => {
    throw new Error(
      "the extension reloaded, but hasn't reconnected — click ⟳ Reload on the reins card in chrome://extensions",
    );
  });
  return `reloaded the reins extension (${version}) — reconnected as ${b.id} (${b.browser})`;
}
