import "./popup.css";
import {
  DEFAULT_POLICY,
  effectiveTier,
  hostOf,
  normalizePattern,
  Policy,
  type Tier,
} from "@reins/protocol";
import { POLICY_KEY, type PolicyChange } from "./lib/policy.js";
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
// that grants access. Edits are sent to the service worker
// (reins:policy-change), which serializes every policy write — a direct
// storage write here could race a concurrent CLI tighten and clobber it.

const policyCurrent = document.getElementById("policy-current") as HTMLElement;
const policyHost = document.getElementById("policy-host") as HTMLElement;
const policySeg = document.getElementById("policy-current-seg") as HTMLElement;
const policyRules = document.getElementById("policy-rules") as HTMLUListElement;
const policyAdd = document.getElementById("policy-add") as HTMLFormElement;
const policyPattern = document.getElementById("policy-pattern") as HTMLInputElement;
const policyError = document.getElementById("policy-error") as HTMLElement;

/** Highlight one tier button in a segmented control. */
function setSegActive(seg: HTMLElement, tier: Tier | undefined): void {
  for (const btn of seg.querySelectorAll<HTMLButtonElement>("button")) {
    const on = btn.dataset.tier === tier;
    btn.classList.toggle("reins__seg--on", on);
    btn.setAttribute("aria-pressed", String(on));
  }
}

/** Tier button under a click event, if any. */
function segClickTier(ev: Event): Tier | undefined {
  return (ev.target as HTMLElement).dataset?.tier as Tier | undefined;
}

const TIER_ORDER: Tier[] = ["full", "read", "deny"];

/**
 * Themed replacement for a native <select>: a button that opens a listbox
 * popover. Option labels come from the root's data-label-<tier> attributes.
 * Setting `.value` re-renders without firing onChange (used by renderPolicy).
 */
function tierSelect(
  root: HTMLElement,
  initial: Tier,
  onChange?: (tier: Tier) => void,
): { value: Tier } {
  const labels: Record<Tier, string> = {
    full: root.dataset.labelFull ?? "Full",
    read: root.dataset.labelRead ?? "Read",
    deny: root.dataset.labelDeny ?? "Deny",
  };
  const name = root.dataset.name ?? "Tier";
  let value = initial;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "reins__select-btn";
  btn.setAttribute("aria-haspopup", "listbox");
  btn.setAttribute("aria-expanded", "false");
  btn.setAttribute("aria-controls", `${root.id}-menu`);
  const labelEl = document.createElement("span");
  labelEl.className = "reins__select-label";
  const chevron = document.createElement("span");
  chevron.className = "reins__select-chevron";
  chevron.setAttribute("aria-hidden", "true");
  chevron.textContent = "▾";
  btn.append(labelEl, chevron);

  const menu = document.createElement("ul");
  menu.id = `${root.id}-menu`;
  menu.className = "reins__select-menu";
  menu.setAttribute("role", "listbox");
  menu.setAttribute("aria-label", name);
  menu.hidden = true;

  const options = TIER_ORDER.map((tier) => {
    const li = document.createElement("li");
    li.setAttribute("role", "option");
    li.tabIndex = -1;
    li.dataset.tier = tier;
    const check = document.createElement("span");
    check.className = "reins__select-check";
    check.setAttribute("aria-hidden", "true");
    check.textContent = "✓";
    const text = document.createElement("span");
    text.textContent = labels[tier];
    li.append(check, text);
    menu.append(li);
    return li;
  });

  function sync(): void {
    labelEl.textContent = labels[value];
    btn.setAttribute("aria-label", `${name}: ${labels[value]}`);
    for (const li of options) {
      li.setAttribute("aria-selected", String(li.dataset.tier === value));
    }
  }
  function open(): void {
    menu.hidden = false;
    btn.setAttribute("aria-expanded", "true");
    (options.find((o) => o.dataset.tier === value) ?? options[0])?.focus();
  }
  function close(focusBtn = false): void {
    menu.hidden = true;
    btn.setAttribute("aria-expanded", "false");
    if (focusBtn) btn.focus();
  }
  function select(tier: Tier): void {
    const changed = tier !== value;
    value = tier;
    sync();
    close(true);
    if (changed) onChange?.(tier);
  }

  btn.addEventListener("click", () => (menu.hidden ? open() : close()));
  btn.addEventListener("keydown", (ev) => {
    if (ev.key === "ArrowDown") {
      ev.preventDefault();
      open();
    } else if (ev.key === "Escape" && !menu.hidden) {
      ev.preventDefault();
      close();
    }
  });
  // Tab / Shift+Tab out of the open menu must not leave it dangling open.
  root.addEventListener("focusout", (ev) => {
    if (!menu.hidden && !root.contains(ev.relatedTarget as Node)) close();
  });
  menu.addEventListener("click", (ev) => {
    const li = (ev.target as HTMLElement).closest("li[data-tier]") as HTMLElement | null;
    if (li) select(li.dataset.tier as Tier);
  });
  menu.addEventListener("keydown", (ev) => {
    const idx = options.indexOf(document.activeElement as HTMLLIElement);
    if (ev.key === "ArrowDown") {
      ev.preventDefault();
      options[Math.min(idx + 1, options.length - 1)]?.focus();
    } else if (ev.key === "ArrowUp") {
      ev.preventDefault();
      options[Math.max(idx - 1, 0)]?.focus();
    } else if (ev.key === "Enter" || ev.key === " ") {
      ev.preventDefault();
      const li = document.activeElement as HTMLElement | null;
      if (li?.dataset.tier) select(li.dataset.tier as Tier);
    } else if (ev.key === "Escape") {
      ev.preventDefault();
      close(true);
    }
  });
  document.addEventListener("click", (ev) => {
    if (!menu.hidden && !root.contains(ev.target as Node)) close();
  });

  root.append(btn, menu);
  sync();
  return {
    get value() {
      return value;
    },
    set value(t: Tier) {
      value = t;
      sync();
    },
  };
}

const policyDefaultDd = tierSelect(
  document.getElementById("policy-default-dd") as HTMLElement,
  "full",
  (tier) => applyChange({ kind: "setDefault", tier }),
);
const policyAddDd = tierSelect(document.getElementById("policy-add-dd") as HTMLElement, "deny");

/** Read-only view of the stored policy. A MISSING key is a fresh install
 *  (default policy); an UNREADABLE or corrupt one throws so renderPolicy
 *  shows the error state — falling back to full-everywhere here would let
 *  one click persist a rule-wiping policy over whatever storage held. */
async function loadPolicyFromStorage(): Promise<Policy> {
  const got = await chrome.storage.local.get(POLICY_KEY);
  return got[POLICY_KEY] === undefined ? DEFAULT_POLICY : Policy.parse(got[POLICY_KEY]);
}

/** Apply an edit via the worker's serialized write queue. */
async function requestPolicyChange(change: PolicyChange): Promise<void> {
  const res = (await chrome.runtime.sendMessage({ type: "reins:policy-change", change })) as
    | { policy?: unknown; error?: string }
    | undefined;
  if (res?.error !== undefined || res?.policy === undefined) {
    throw new Error(res?.error ?? "policy update failed");
  }
  await renderPolicy();
}

/** requestPolicyChange for fire-from-a-click paths: on failure, re-render
 *  from storage so optimistic UI (dropdown label, seg highlight) snaps back
 *  to the truth instead of showing an unsaved value. */
function applyChange(change: PolicyChange): void {
  requestPolicyChange(change).catch((err: unknown) => {
    console.error("reins: policy change failed", err);
    void renderPolicy();
  });
}

async function activeHost(): Promise<string | undefined> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return hostOf(tab?.url ?? "");
  } catch {
    return undefined;
  }
}

function setPolicyErrorState(broken: boolean): void {
  policyError.hidden = !broken;
  policyCurrent.hidden = policyCurrent.hidden || broken;
  for (const el of [policyRules, policyAdd]) el.hidden = broken;
  const defaultRow = document.getElementById("policy-default-dd")?.parentElement;
  if (defaultRow) defaultRow.hidden = broken;
}

async function renderPolicy(): Promise<void> {
  let p: Policy;
  try {
    p = await loadPolicyFromStorage();
  } catch {
    // Corrupt/unreadable policy: the worker fails closed; mirror that here
    // instead of rendering (and then persisting) full-access defaults.
    setPolicyErrorState(true);
    return;
  }
  setPolicyErrorState(false);
  const host = await activeHost();

  policyDefaultDd.value = p.defaultTier;

  policyCurrent.hidden = host === undefined;
  if (host !== undefined) {
    policyHost.textContent = host;
    setSegActive(policySeg, effectiveTier(p, host));
  }

  policyRules.replaceChildren(
    ...p.rules.map((r) => {
      const li = document.createElement("li");
      li.className = "reins__policy-rule";
      const pattern = document.createElement("code");
      pattern.className = "reins__policy-pattern";
      pattern.textContent = r.pattern;
      const badge = document.createElement("span");
      badge.className = `reins__tier reins__tier--${r.tier}`;
      badge.textContent = r.tier;
      const del = document.createElement("button");
      del.type = "button";
      del.className = "reins__policy-del";
      del.textContent = "×";
      del.setAttribute("aria-label", `remove rule for ${r.pattern}`);
      del.addEventListener("click", () => {
        applyChange({ kind: "remove", pattern: r.pattern });
      });
      li.append(pattern, badge, del);
      return li;
    }),
  );
}

policySeg.addEventListener("click", (ev) => {
  const tier = segClickTier(ev);
  if (!tier) return;
  void activeHost().then((host) => {
    if (host !== undefined) applyChange({ kind: "upsert", pattern: host, tier });
  });
});

// A custom validity error makes the browser swallow future submit events,
// so the form is novalidate and the error is cleared on input — otherwise
// one bad attempt would block every submit after it, valid or not.
policyPattern.addEventListener("input", () => policyPattern.setCustomValidity(""));

policyAdd.addEventListener("submit", (ev) => {
  ev.preventDefault();
  // Validate the pattern locally so a storage/messaging failure is never
  // misreported as a syntax problem.
  let pattern: string;
  try {
    pattern = normalizePattern(policyPattern.value);
  } catch {
    policyPattern.setCustomValidity("use host.com or *.host.com");
    policyAdd.reportValidity();
    return;
  }
  void (async () => {
    try {
      await requestPolicyChange({ kind: "upsert", pattern, tier: policyAddDd.value });
      policyPattern.value = "";
      policyPattern.setCustomValidity("");
    } catch {
      policyPattern.setCustomValidity("couldn't save the rule — try again");
      policyAdd.reportValidity();
    }
  })();
});

// Policy can change while the popup is open (CLI tighten via the worker);
// re-render on any storage change to the key so the view never goes stale.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && POLICY_KEY in changes) void renderPolicy();
});

void refresh();
void renderPolicy();
