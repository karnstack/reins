export type WorkerStatus = "idle" | "connecting" | "connected";

/** Map any inbound status-update value to the worker's status set.
 *  BridgeClient emits "disconnected" → treat as idle. */
export function normalizeStatus(raw: unknown): WorkerStatus {
  if (raw === "connecting" || raw === "connected") return raw;
  return "idle"; // "disconnected", unknown, null/undefined → idle
}
