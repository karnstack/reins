import { portCandidates } from "@reins/protocol";

export interface Settings {
  /** Reconnect automatically (the popup toggle). Default on. */
  autoConnect: boolean;
  /** Port that last produced a welcome — tried first on the next scan. */
  lastPort?: number;
  /** Advanced: pin the daemon port exactly (REINS_PORT setups); skips discovery. */
  portOverride?: number;
}

const AUTO_KEY = "reinsAutoConnect";
const LAST_PORT_KEY = "reinsLastPort";
const OVERRIDE_KEY = "reinsPortOverride";

function asPort(v: unknown): number | undefined {
  return typeof v === "number" && Number.isInteger(v) && v > 0 && v < 65536 ? v : undefined;
}

export async function loadSettings(): Promise<Settings> {
  const got = await chrome.storage.local.get([AUTO_KEY, LAST_PORT_KEY, OVERRIDE_KEY]);
  return {
    autoConnect: typeof got[AUTO_KEY] === "boolean" ? got[AUTO_KEY] : true,
    lastPort: asPort(got[LAST_PORT_KEY]),
    portOverride: asPort(got[OVERRIDE_KEY]),
  };
}

export async function saveSettings(s: Partial<Settings>): Promise<void> {
  const items: Record<string, unknown> = {};
  if (s.autoConnect !== undefined) items[AUTO_KEY] = s.autoConnect;
  if ("lastPort" in s) items[LAST_PORT_KEY] = s.lastPort ?? null;
  if ("portOverride" in s) items[OVERRIDE_KEY] = s.portOverride ?? null;
  await chrome.storage.local.set(items);
}

/** Candidate ws:// URLs for daemon discovery, best guess first. */
export function candidateUrls(s: Settings): string[] {
  if (s.portOverride !== undefined) return [`ws://127.0.0.1:${s.portOverride}`];
  const ports = [
    ...new Set([...(s.lastPort !== undefined ? [s.lastPort] : []), ...portCandidates()]),
  ];
  return ports.map((p) => `ws://127.0.0.1:${p}`);
}

/** Extract the port from a candidate URL (to persist as lastPort). */
export function portFromUrl(url: string): number | undefined {
  try {
    return asPort(Number(new URL(url).port));
  } catch {
    return undefined;
  }
}
