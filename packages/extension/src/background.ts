import { dispatchMethod } from "./lib/dispatch.js";
import { applyPolicyChange, type PolicyChange } from "./lib/policy.js";
import { candidateUrls, loadSettings, saveSettings } from "./lib/settings.js";
import { normalizeStatus, type WorkerStatus } from "./lib/status.js";

type Status = WorkerStatus;

const STATUS_KEY = "reinsStatus";
const CONN_INFO_KEY = "reinsConnInfo";

/** What the popup shows about the live connection (from the welcome frame). */
export interface ConnInfo {
  port?: number;
  version?: string;
  browserId?: string;
  browser?: string;
}

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
          justification: "Maintain a persistent WebSocket connection to the local reins daemon.",
        });
      }
    })().finally(() => {
      offscreenPromise = undefined;
    });
  }
  return offscreenPromise;
}

/** Connect (via the offscreen document) if auto-connect is enabled. */
async function autoConnect(): Promise<void> {
  const settings = await loadSettings();
  if (!settings.autoConnect) return;
  await ensureOffscreen();
  send({ type: "offscreen:connect", urls: candidateUrls(settings) });
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
 *   reins:connect        — popup enables auto-connect and asks for a connection
 *   reins:disconnect     — popup disables auto-connect and drops the bridge
 *   reins:status         — popup polls current connection status
 *   reins:status-update  — offscreen document reports a new status
 *   reins:connected-port — offscreen reports which port answered (persisted
 *                          as lastPort so the next scan tries it first)
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
        void saveSettings({ autoConnect: true }).then(() => autoConnect());
        return;
      }

      case "reins:disconnect": {
        void saveSettings({ autoConnect: false });
        send({ type: "offscreen:disconnect" });
        writeStatus("idle");
        return;
      }

      case "reins:status": {
        void (async () => {
          const status = await readStatus();
          let info: ConnInfo | undefined;
          try {
            const got = await chrome.storage.session.get(CONN_INFO_KEY);
            info = got[CONN_INFO_KEY] as ConnInfo | undefined;
          } catch {
            // no info — popup shows status only
          }
          sendResponse({ status, info });
        })();
        return true;
      }

      case "reins:status-update": {
        writeStatus(normalizeStatus(message.status));
        return;
      }

      case "reins:connected-info": {
        const info: ConnInfo = {
          port: typeof message.port === "number" ? message.port : undefined,
          version: typeof message.version === "string" ? message.version : undefined,
          browserId: typeof message.browserId === "string" ? message.browserId : undefined,
          browser: typeof message.browser === "string" ? message.browser : undefined,
        };
        void chrome.storage.session.set({ [CONN_INFO_KEY]: info }).catch(() => {});
        if (info.port !== undefined) {
          void saveSettings({ lastPort: info.port }).catch(() => {});
        }
        return;
      }

      case "reins:policy-change": {
        // Popup edits route through the worker so every policy write shares
        // the single-writer queue with policy_tighten (no lost updates).
        applyPolicyChange(message.change as PolicyChange)
          .then((policy) => sendResponse({ policy }))
          .catch((err) =>
            sendResponse({ error: err instanceof Error ? err.message : String(err) }),
          );
        return true;
      }

      case "reins:dispatch": {
        const method = message.method as string;
        const params = message.params;
        dispatchMethod(method, params)
          .then((result) => sendResponse({ result }))
          .catch((err) =>
            sendResponse({
              error: err instanceof Error ? err.message : String(err),
              code:
                typeof (err as { code?: unknown })?.code === "string"
                  ? (err as { code: string }).code
                  : undefined,
            }),
          );
        return true;
      }
    }
  },
);
