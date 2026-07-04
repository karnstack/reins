import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type Log = (message: string) => void;

/** Directory where reins server logs live (~/.reins/logs). */
export function logsDir(home = homedir()): string {
  return join(home, ".reins", "logs");
}

/** Log file for a given day, e.g. ~/.reins/logs/daemon-2026-07-04.log. */
export function logFilePath(dir: string, now = new Date()): string {
  const day = now.toISOString().slice(0, 10);
  return join(dir, `daemon-${day}.log`);
}

/**
 * Logger that mirrors every line to stderr (visible when running in the foreground)
 * and appends it to a dated file under ~/.reins/logs. File writes are
 * best-effort: a full disk or bad permissions must never take the server down.
 */
export function createLogger(dir = logsDir()): Log {
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    // fall through — stderr logging still works
  }
  return (message: string) => {
    const line = `${new Date().toISOString()} ${message}`;
    process.stderr.write(`${line}\n`);
    try {
      appendFileSync(logFilePath(dir), `${line}\n`);
    } catch {
      // best-effort
    }
  };
}
