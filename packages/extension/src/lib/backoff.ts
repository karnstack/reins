/** Exponential backoff (ms) for the M1 WS reconnect loop. */
export function nextBackoff(attempt: number, baseMs = 500, maxMs = 5_000): number {
  return Math.min(baseMs * 2 ** attempt, maxMs);
}
