import { BridgeClient, type SocketLike } from "./lib/bridge-client.js";
import { portFromUrl } from "./lib/settings.js";

let client: BridgeClient | undefined;

/**
 * Relay dispatch requests to the background service worker, which owns the
 * chrome.* APIs (e.g. chrome.tabs). The service worker returns { result } on
 * success or { error } on failure.
 */
async function offscreenDispatch(method: string, params: unknown): Promise<unknown> {
  const res = (await chrome.runtime.sendMessage({ type: "reins:dispatch", method, params })) as
    | { result: unknown; error?: undefined }
    | { error: string; result?: undefined }
    | undefined;
  if (res?.error) throw new Error(res.error);
  return res?.result;
}

/** Best-effort human browser name (Chrome, Brave, Edge, …) for the daemon's roster. */
function browserName(): string {
  const brands =
    (
      navigator as Navigator & {
        userAgentData?: { brands?: Array<{ brand: string }> };
      }
    ).userAgentData?.brands ?? [];
  const real = brands.find((b) => !/Not.?A.?Brand/i.test(b.brand) && b.brand !== "Chromium")?.brand;
  return real ?? brands.find((b) => b.brand === "Chromium")?.brand ?? "browser";
}

chrome.runtime.onMessage.addListener((msg: unknown) => {
  if (!msg || typeof msg !== "object") return;
  const message = msg as Record<string, unknown>;

  if (message.type === "offscreen:connect") {
    const urls = Array.isArray(message.urls) ? (message.urls as string[]) : [];
    if (urls.length === 0) return;
    // Stop any existing client before creating a new one to avoid duplicate sockets.
    client?.stop();
    client = new BridgeClient({
      urls: () => urls,
      browser: browserName(),
      // The browser WebSocket shape is compatible with SocketLike at runtime:
      // MessageEvent has .data and CloseEvent has .code, matching the interface.
      // The double-cast is intentional — the event handler signatures differ at
      // the TypeScript level but are wire-compatible.
      createSocket: (u) => new WebSocket(u) as unknown as SocketLike,
      dispatch: offscreenDispatch,
      onStatus: (s) => {
        // .catch: the worker may be waking up with no listener yet — the
        // status lands in session storage on the next update; don't spam
        // the offscreen console with unhandled rejections.
        void chrome.runtime.sendMessage({ type: "reins:status-update", status: s }).catch(() => {});
      },
      onConnected: (url, welcome) => {
        void chrome.runtime
          .sendMessage({
            type: "reins:connected-info",
            port: portFromUrl(url),
            version: welcome.version,
            browserId: welcome.browserId,
            browser: browserName(),
          })
          .catch(() => {});
      },
    });
    client.start();
    return;
  }

  if (message.type === "offscreen:disconnect") {
    client?.stop();
    client = undefined;
    return;
  }
});
