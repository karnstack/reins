export type WorkerStatus = "idle" | "connecting" | "connected" | "error";

/** Map any inbound status-update value to the worker's status set.
 *  BridgeClient emits "disconnected" → treat as idle; "error" stays error. */
export function normalizeStatus(raw: unknown): WorkerStatus {
  if (raw === "connecting" || raw === "connected" || raw === "error") return raw;
  return "idle"; // "disconnected", unknown, null/undefined → idle
}
