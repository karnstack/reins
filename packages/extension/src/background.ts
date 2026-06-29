import { dispatchMethod } from "./lib/dispatch.js";
import { loadPairing } from "./lib/pairing.js";

type Status = "idle" | "connecting" | "connected" | "error";

let status: Status = "idle";

/**
 * Ensure the offscreen document is alive; create it if none exists.
 *
 * NOTE: No MV3 offscreen reason maps perfectly to a long-lived WebSocket.
 * WORKERS is the pragmatic choice — it signals background script-like work and
 * is accepted by Chrome for this pattern. Reasons like BLOBS or IFRAME_SCRIPTING
 * would be misleading.
 * See https://developer.chrome.com/docs/extensions/reference/api/offscreen#type-Reason
 */
async function ensureOffscreen(): Promise<void> {
  if (await chrome.offscreen.hasDocument()) return;
  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: [chrome.offscreen.Reason.WORKERS],
    justification: "Maintain a persistent WebSocket connection to the local reins MCP server.",
  });
}

async function autoConnect(): Promise<void> {
  const p = await loadPairing();
  if (!p) return;
  await ensureOffscreen();
  void chrome.runtime.sendMessage({
    type: "offscreen:connect",
    url: p.url,
    token: p.token,
    browser: "reins-extension",
  });
}

chrome.runtime.onStartup.addListener(() => {
  void autoConnect();
});

chrome.runtime.onInstalled.addListener(() => {
  void autoConnect();
});

/**
 * Central message router for the service worker.
 *
 * Inbound types handled here:
 *   reins:connect        — popup asks worker to open the bridge
 *   reins:disconnect     — popup asks worker to close the bridge
 *   reins:status         — popup polls current connection status
 *   reins:status-update  — offscreen document reports a new status
 *   reins:dispatch       — offscreen document asks worker to call a chrome.* handler
 *
 * The worker also sends outbound messages (offscreen:connect, offscreen:disconnect).
 * Those have the "offscreen:" prefix so they pass through the switch unhandled,
 * avoiding any accidental self-processing if the runtime reflects them back.
 */
chrome.runtime.onMessage.addListener(
  (
    msg: unknown,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void,
  ) => {
    if (!msg || typeof msg !== "object") return;
    const message = msg as Record<string, unknown>;

    switch (message.type) {
      case "reins:connect": {
        void (async () => {
          const p = await loadPairing();
          if (!p) return;
          await ensureOffscreen();
          void chrome.runtime.sendMessage({
            type: "offscreen:connect",
            url: p.url,
            token: p.token,
            browser: "reins-extension",
          });
        })();
        return;
      }

      case "reins:disconnect": {
        void chrome.runtime.sendMessage({ type: "offscreen:disconnect" });
        status = "idle";
        return;
      }

      case "reins:status": {
        sendResponse({ status });
        return true;
      }

      case "reins:status-update": {
        status = (message.status as Status | undefined) ?? "idle";
        return;
      }

      case "reins:dispatch": {
        const method = message.method as string;
        const params = message.params;
        dispatchMethod(method, params)
          .then((result) => sendResponse({ result }))
          .catch((err) =>
            sendResponse({ error: err instanceof Error ? err.message : String(err) }),
          );
        return true;
      }
    }
  },
);
