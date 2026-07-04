import "./popup.css";
import { loadSettings, saveSettings } from "./lib/settings.js";
import { normalizeStatus, type WorkerStatus } from "./lib/status.js";

interface ConnInfo {
  port?: number;
  version?: string;
  browserId?: string;
  browser?: string;
}

const statusEl = document.getElementById("status") as HTMLElement;
const statusLabel = document.getElementById("status-label") as HTMLElement;
const infoEl = document.getElementById("info") as HTMLElement;
const infoDaemon = document.getElementById("info-daemon") as HTMLElement;
const infoBrowser = document.getElementById("info-browser") as HTMLElement;
const hintEl = document.getElementById("hint") as HTMLElement;
const toggleBtn = document.getElementById("toggle") as HTMLButtonElement;
const portInput = document.getElementById("port") as HTMLInputElement;
const savePortBtn = document.getElementById("save-port") as HTMLButtonElement;

const LABELS: Record<WorkerStatus, string> = {
  idle: "Disconnected",
  connecting: "Connecting…",
  connected: "Connected",
};

function render(status: WorkerStatus, info?: ConnInfo): void {
  statusEl.className = `reins__status reins__status--${status}`;
  statusLabel.textContent = LABELS[status];

  const connected = status === "connected";
  infoEl.hidden = !connected;
  hintEl.hidden = connected;
  if (connected && info) {
    infoDaemon.textContent = `${info.version ? `v${info.version}` : "reins"} · 127.0.0.1:${info.port ?? "?"}`;
    infoBrowser.textContent = info.browserId
      ? `${info.browserId}${info.browser ? ` (${info.browser})` : ""}`
      : (info.browser ?? "connected");
  }
}

function setToggle(autoConnect: boolean): void {
  toggleBtn.textContent = autoConnect ? "Disconnect" : "Connect";
  toggleBtn.classList.toggle("reins__btn--danger", autoConnect);
}

function notifyBackground(type: string): void {
  try {
    chrome.runtime.sendMessage({ type }, () => void chrome.runtime.lastError);
  } catch {
    // worker unavailable; settings are persisted regardless
  }
}

async function refresh(): Promise<void> {
  const settings = await loadSettings();
  portInput.value = settings.portOverride !== undefined ? String(settings.portOverride) : "";
  setToggle(settings.autoConnect);
  try {
    const res = (await chrome.runtime.sendMessage({ type: "reins:status" })) as
      | { status?: unknown; info?: ConnInfo }
      | undefined;
    render(normalizeStatus(res?.status), res?.info);
  } catch {
    render("idle");
  }
}

// Live-update the pill when the worker/offscreen reports a status change.
chrome.runtime.onMessage.addListener((msg: unknown) => {
  if (!msg || typeof msg !== "object") return;
  const message = msg as Record<string, unknown>;
  if (message.type === "reins:status-update") {
    // Re-query for the full picture (status + connection info).
    void refresh();
  }
});

toggleBtn.addEventListener("click", async () => {
  const settings = await loadSettings();
  if (settings.autoConnect) {
    notifyBackground("reins:disconnect");
    setToggle(false);
    render("idle");
  } else {
    notifyBackground("reins:connect");
    setToggle(true);
    render("connecting");
  }
});

savePortBtn.addEventListener("click", async () => {
  const raw = portInput.value.trim();
  const port = raw === "" ? undefined : Number(raw);
  if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65535)) return;
  await saveSettings({ portOverride: port });
  notifyBackground("reins:connect");
  render("connecting");
});

void refresh();
