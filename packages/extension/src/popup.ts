import "./popup.css";
import { DEFAULT_POLICY, effectiveTier, hostOf, Policy, type Tier } from "@reins/protocol";
import { POLICY_KEY } from "./lib/policy.js";
import { removeRule, setDefaultTier, upsertRule } from "./lib/policy-view.js";
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

// ─── Site permissions ────────────────────────────────────────────────────────
// The popup is the ONLY loosening surface: a click here is the user gesture
// that grants access. It writes chrome.storage.local directly; the service
// worker's policy cache refreshes via storage.onChanged.

const policyCurrent = document.getElementById("policy-current") as HTMLElement;
const policyHost = document.getElementById("policy-host") as HTMLElement;
const policySeg = document.getElementById("policy-current-seg") as HTMLElement;
const policyDefault = document.getElementById("policy-default") as HTMLSelectElement;
const policyRules = document.getElementById("policy-rules") as HTMLUListElement;
const policyAdd = document.getElementById("policy-add") as HTMLFormElement;
const policyPattern = document.getElementById("policy-pattern") as HTMLInputElement;
const policyAddTier = document.getElementById("policy-add-tier") as HTMLSelectElement;

async function loadPolicyFromStorage(): Promise<Policy> {
  try {
    const got = await chrome.storage.local.get(POLICY_KEY);
    return got[POLICY_KEY] === undefined ? DEFAULT_POLICY : Policy.parse(got[POLICY_KEY]);
  } catch {
    return DEFAULT_POLICY;
  }
}

async function writePolicy(p: Policy): Promise<void> {
  await chrome.storage.local.set({ [POLICY_KEY]: p });
  await renderPolicy();
}

async function activeHost(): Promise<string | undefined> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return hostOf(tab?.url ?? "");
  } catch {
    return undefined;
  }
}

async function renderPolicy(): Promise<void> {
  const p = await loadPolicyFromStorage();
  const host = await activeHost();

  policyDefault.value = p.defaultTier;

  policyCurrent.hidden = host === undefined;
  if (host !== undefined) {
    policyHost.textContent = host;
    const tier = effectiveTier(p, host);
    for (const btn of policySeg.querySelectorAll<HTMLButtonElement>("button")) {
      btn.classList.toggle("reins__seg--on", btn.dataset.tier === tier);
    }
  }

  policyRules.replaceChildren(
    ...p.rules.map((r) => {
      const li = document.createElement("li");
      li.className = "reins__policy-rule";
      const label = document.createElement("code");
      label.textContent = `${r.pattern} · ${r.tier}`;
      const del = document.createElement("button");
      del.type = "button";
      del.className = "reins__policy-del";
      del.textContent = "×";
      del.setAttribute("aria-label", `remove rule for ${r.pattern}`);
      del.addEventListener("click", () => {
        void loadPolicyFromStorage().then((cur) => writePolicy(removeRule(cur, r.pattern)));
      });
      li.append(label, del);
      return li;
    }),
  );
}

policySeg.addEventListener("click", (ev) => {
  const tier = (ev.target as HTMLElement).dataset?.tier as Tier | undefined;
  if (!tier) return;
  void (async () => {
    const host = await activeHost();
    if (host === undefined) return;
    await writePolicy(upsertRule(await loadPolicyFromStorage(), host, tier));
  })();
});

policyDefault.addEventListener("change", () => {
  void loadPolicyFromStorage().then((p) =>
    writePolicy(setDefaultTier(p, policyDefault.value as Tier)),
  );
});

policyAdd.addEventListener("submit", (ev) => {
  ev.preventDefault();
  void (async () => {
    try {
      const p = await loadPolicyFromStorage();
      await writePolicy(upsertRule(p, policyPattern.value, policyAddTier.value as Tier));
      policyPattern.value = "";
      policyPattern.setCustomValidity("");
    } catch {
      policyPattern.setCustomValidity("use host.com or *.host.com");
      policyAdd.reportValidity();
    }
  })();
});

void refresh();
void renderPolicy();
