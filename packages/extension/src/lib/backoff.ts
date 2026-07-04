/** Exponential backoff (ms) for the WS reconnect loop. Capped at 10s — the
 *  daemon may start long after the browser, so the client retries forever. */
export function nextBackoff(attempt: number, baseMs = 500, maxMs = 10_000): number {
  return Math.min(baseMs * 2 ** attempt, maxMs);
}
