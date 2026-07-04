/**
 * ADDITIVE per-tab console/network monitor.
 *
 * IMPORTANT LIMITATIONS (v1):
 *
 * (a) ONE DEBUGGER SESSION PER TAB: this module holds a persistent
 *     chrome.debugger attach for each monitored tab. The per-call tools
 *     (click, navigate, screenshot, … — see cdp.ts withDebugger) detect a
 *     monitored tab via isMonitored() and reuse this session instead of
 *     attaching their own, so monitored tabs stay drivable. A tab attached
 *     by DevTools or another extension still cannot be monitored.
 *
 * (b) EVENTS SINCE MONITORING BEGAN: read_console and read_network only see
 *     events captured SINCE monitoring began for that tab (the first read
 *     call triggers attach+enable). CDP does not replay past events.
 *
 * (c) CONSOLE CAPTURE SCOPE: console capture covers `console.*` calls only
 *     (CDP `Runtime.consoleAPICalled`). It does NOT include uncaught exceptions
 *     or failed-resource errors. Console levels use CDP's `type` strings:
 *     `"log"`, `"info"`, `"warning"` (NOT `"warn"`), `"error"`, `"debug"`.
 */

import type { ConsoleEntry, ConsoleParams, NetworkEntry, NetworkParams } from "@reins/protocol";
import { filterConsole, filterNetwork } from "./event-filter.js";
import { RingBuffer } from "./ring-buffer.js";

const RING_CAPACITY = 500;
const PROTOCOL = "1.3";

interface Monitor {
  console: RingBuffer<ConsoleEntry>;
  network: RingBuffer<NetworkEntry>;
  byRequestId: Map<string, NetworkEntry>;
}

const MONITORS = new Map<number, Monitor>();

// Per-tab in-flight promise map to serialize concurrent ensureMonitor calls.
const IN_FLIGHT = new Map<number, Promise<Monitor>>();

// Single module-level onEvent listener (added once at module load).
chrome.debugger.onEvent.addListener((source, method, params) => {
  const tabId = source.tabId;
  if (tabId === undefined) return;
  const mon = MONITORS.get(tabId);
  if (!mon) return;

  if (method === "Runtime.consoleAPICalled") {
    const p = params as unknown as {
      type: string;
      args: Array<{ value?: unknown; description?: string }>;
      timestamp: number;
    };
    const text = p.args
      .map((a) => (a.value !== undefined ? String(a.value) : (a.description ?? "")))
      .join(" ");
    // Runtime.consoleAPICalled timestamp is Runtime.Timestamp = ms since epoch already.
    mon.console.push({ level: p.type, text, timestamp: p.timestamp });
  } else if (method === "Network.requestWillBeSent") {
    const p = params as unknown as {
      requestId: string;
      request: { method: string; url: string };
      timestamp: number; // Network.MonotonicTime — NOT epoch; do not use for display
      wallTime: number; // Network.TimeSinceEpoch = seconds since epoch — use this
    };
    const entry: NetworkEntry = {
      method: p.request.method,
      url: p.request.url,
      status: undefined,
      // wallTime is seconds since epoch; convert to epoch-ms for consistency with console.
      timestamp: p.wallTime * 1000,
    };
    // Backstop: if the map has grown beyond ring capacity, evict the oldest entry.
    if (mon.byRequestId.size >= RING_CAPACITY) {
      const oldest = mon.byRequestId.keys().next().value;
      if (oldest !== undefined) mon.byRequestId.delete(oldest);
    }
    mon.network.push(entry);
    mon.byRequestId.set(p.requestId, entry);
  } else if (method === "Network.responseReceived") {
    const p = params as unknown as {
      requestId: string;
      response: { status: number };
    };
    const entry = mon.byRequestId.get(p.requestId);
    if (entry) {
      // Mutate in place — the buffered object is the same reference.
      // NOTE: if the ring buffer has evicted this entry, byRequestId still
      // holds the stale reference; clear it to avoid unbounded growth.
      entry.status = p.response.status;
    }
    // Always clean up byRequestId after response — eviction may have orphaned it.
    mon.byRequestId.delete(p.requestId);
  } else if (method === "Network.loadingFailed") {
    const p = params as unknown as { requestId: string };
    // Request failed / was aborted or blocked — it will never receive a response.
    // Remove the map entry to prevent unbounded growth; the ring buffer entry remains.
    mon.byRequestId.delete(p.requestId);
  }
});

// Cleanup on tab close / explicit detach.
chrome.debugger.onDetach.addListener((source) => {
  const tabId = source.tabId;
  if (tabId !== undefined) MONITORS.delete(tabId);
});

/** True if this module holds (or is acquiring) the debugger session for the tab. */
export function isMonitored(tabId: number): boolean {
  return MONITORS.has(tabId);
}

async function attachMonitor(tabId: number): Promise<Monitor> {
  try {
    await chrome.debugger.attach({ tabId }, PROTOCOL);
  } catch (attachErr) {
    // The MV3 service worker may have been restarted while our debugger
    // session survived: MONITORS is empty but the tab is still attached by
    // this extension. Probe with a command — if it succeeds we own the
    // session and can adopt it; if it fails, someone else (DevTools, another
    // extension) holds the tab, so surface the original attach error.
    try {
      await chrome.debugger.sendCommand({ tabId }, "Runtime.enable");
    } catch {
      throw attachErr;
    }
  }
  try {
    await chrome.debugger.sendCommand({ tabId }, "Runtime.enable");
    await chrome.debugger.sendCommand({ tabId }, "Network.enable");
  } catch (e) {
    await chrome.debugger.detach({ tabId }).catch(() => {});
    throw e;
  }
  const mon: Monitor = {
    console: new RingBuffer<ConsoleEntry>(RING_CAPACITY),
    network: new RingBuffer<NetworkEntry>(RING_CAPACITY),
    byRequestId: new Map(),
  };
  MONITORS.set(tabId, mon);
  return mon;
}

async function ensureMonitor(tabId: number): Promise<Monitor> {
  const existing = MONITORS.get(tabId);
  if (existing) return existing;

  // Serialize: if an attach is already in flight for this tabId, wait for it.
  const inFlight = IN_FLIGHT.get(tabId);
  if (inFlight) return inFlight;

  const promise = attachMonitor(tabId).finally(() => IN_FLIGHT.delete(tabId));
  IN_FLIGHT.set(tabId, promise);
  return promise;
}

async function resolveTabId(tabId?: number): Promise<number> {
  if (typeof tabId === "number") return tabId;
  const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (active?.id === undefined) throw new Error("no active tab");
  return active.id;
}

export async function readConsole(params: ConsoleParams): Promise<{ entries: ConsoleEntry[] }> {
  const tabId = await resolveTabId(params.tabId);
  const mon = await ensureMonitor(tabId);
  return { entries: filterConsole(mon.console.toArray(), params) };
}

export async function readNetwork(params: NetworkParams): Promise<{ entries: NetworkEntry[] }> {
  const tabId = await resolveTabId(params.tabId);
  const mon = await ensureMonitor(tabId);
  return { entries: filterNetwork(mon.network.toArray(), params) };
}
