import { BridgeClient, type SocketLike } from "./lib/bridge-client.js";

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

chrome.runtime.onMessage.addListener((msg: unknown) => {
  if (!msg || typeof msg !== "object") return;
  const message = msg as Record<string, unknown>;

  if (message.type === "offscreen:connect") {
    const { url, token, browser } = message as {
      type: string;
      url: string;
      token: string;
      browser: string;
    };
    // Stop any existing client before creating a new one to avoid duplicate sockets.
    client?.stop();
    client = new BridgeClient({
      url,
      token,
      browser,
      // The browser WebSocket shape is compatible with SocketLike at runtime:
      // MessageEvent has .data and CloseEvent has .code, matching the interface.
      // The double-cast is intentional — the event handler signatures differ at
      // the TypeScript level but are wire-compatible.
      createSocket: (u) => new WebSocket(u) as unknown as SocketLike,
      dispatch: offscreenDispatch,
      onStatus: (s) => {
        void chrome.runtime.sendMessage({ type: "reins:status-update", status: s });
      },
      onAuthError: () => {
        void chrome.runtime.sendMessage({ type: "reins:status-update", status: "error" });
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
