import { dispatchMethod } from "./lib/dispatch.js";
import { loadPairing } from "./lib/pairing.js";
import { normalizeStatus, type WorkerStatus } from "./lib/status.js";

type Status = WorkerStatus;

const STATUS_KEY = "reinsStatus";

/**
 * Connection status lives in chrome.storage.session, not a module variable:
 * MV3 kills an idle service worker after ~30s, and a plain variable would
 * reset to "idle" on the next wake even though the offscreen document is
 * still happily connected. session storage survives worker restarts (and is
 * cleared when the browser exits, which matches the connection's lifetime).
 */
async function readStatus(): Promise<Status> {
  try {
    const got = await chrome.storage.session.get(STATUS_KEY);
    return normalizeStatus(got[STATUS_KEY]);
  } catch {
    return "idle";
  }
}

function writeStatus(status: Status): void {
  void chrome.storage.session.set({ [STATUS_KEY]: status }).catch(() => {});
}

/** Fire-and-forget runtime message; swallow "no receiver" rejections. */
function send(message: Record<string, unknown>): void {
  void chrome.runtime.sendMessage(message).catch(() => {});
}

/**
 * Ensure the offscreen document is alive; create it if none exists.
 *
 * NOTE: No MV3 offscreen reason maps perfectly to a long-lived WebSocket.
 * WORKERS is the pragmatic choice — it signals background script-like work and
 * is accepted by Chrome for this pattern. Reasons like BLOBS or IFRAME_SCRIPTING
 * would be misleading.
 * See https://developer.chrome.com/docs/extensions/reference/api/offscreen#type-Reason
 */
let offscreenPromise: Promise<void> | undefined;
function ensureOffscreen(): Promise<void> {
  if (!offscreenPromise) {
    offscreenPromise = (async () => {
      if (!(await chrome.offscreen.hasDocument())) {
        await chrome.offscreen.createDocument({
          url: "src/offscreen.html",
          reasons: [chrome.offscreen.Reason.WORKERS],
          justification:
            "Maintain a persistent WebSocket connection to the local reins MCP server.",
        });
      }
    })().finally(() => {
      offscreenPromise = undefined;
    });
  }
  return offscreenPromise;
}

async function autoConnect(): Promise<void> {
  const p = await loadPairing();
  if (!p) return;
  await ensureOffscreen();
  send({
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
        void autoConnect();
        return;
      }

      case "reins:disconnect": {
        send({ type: "offscreen:disconnect" });
        writeStatus("idle");
        return;
      }

      case "reins:status": {
        void readStatus().then((status) => sendResponse({ status }));
        return true;
      }

      case "reins:status-update": {
        writeStatus(normalizeStatus(message.status));
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
