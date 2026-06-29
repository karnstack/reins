import "./popup.css";
import { clearPairing, loadPairing, savePairing } from "./lib/pairing.js";

type Status = "idle" | "connecting" | "connected" | "error";

const form = document.getElementById("pair-form") as HTMLFormElement;
const urlInput = document.getElementById("url") as HTMLInputElement;
const tokenInput = document.getElementById("token") as HTMLInputElement;
const disconnectBtn = document.getElementById("disconnect") as HTMLButtonElement;
const statusEl = document.getElementById("status") as HTMLElement;
const statusLabel = document.getElementById("status-label") as HTMLElement;

const STATUS_LABELS: Record<Status, string> = {
  idle: "Not paired",
  connecting: "Connecting…",
  connected: "Connected",
  error: "Auth failed",
};

function setStatus(status: Status, label = STATUS_LABELS[status]): void {
  statusEl.className = `reins__status reins__status--${status}`;
  statusLabel.textContent = label;
}

/** Fire-and-forget message to the background worker (lands in M1b-wire). */
function notifyBackground(type: string): void {
  try {
    chrome.runtime.sendMessage({ type }, () => void chrome.runtime.lastError);
  } catch {
    // No background handler yet (pre-M1b-wire) — pairing is still persisted.
  }
}

async function refresh(): Promise<void> {
  const pairing = await loadPairing();
  if (pairing) {
    urlInput.value = pairing.url;
    tokenInput.value = pairing.token;
    disconnectBtn.hidden = false;
    setStatus("idle", "Paired");
  } else {
    disconnectBtn.hidden = true;
    setStatus("idle");
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const url = urlInput.value.trim();
  const token = tokenInput.value.trim();
  if (!url || !token) return;
  await savePairing({ url, token });
  disconnectBtn.hidden = false;
  setStatus("connecting");
  notifyBackground("reins:connect");
});

disconnectBtn.addEventListener("click", async () => {
  await clearPairing();
  tokenInput.value = "";
  disconnectBtn.hidden = true;
  setStatus("idle");
  notifyBackground("reins:disconnect");
});

void refresh();
