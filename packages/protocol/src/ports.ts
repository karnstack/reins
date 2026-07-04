/** Default bridge/daemon port and discovery range, shared by server and extension. */
export const DEFAULT_PORT = 8765;
export const PORT_RANGE = 10;

/** Candidate ports both sides walk: DEFAULT_PORT … DEFAULT_PORT + PORT_RANGE - 1. */
export function portCandidates(): number[] {
  return Array.from({ length: PORT_RANGE }, (_, i) => DEFAULT_PORT + i);
}
