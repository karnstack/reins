import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DEFAULT_PORT, portCandidates } from "@reins/protocol";

export interface ReinsConfig {
  dir: string;
  /** Preferred port: REINS_PORT (exact), else the last recorded bound port, else 8765. */
  port: number;
  /** True when REINS_PORT (or an explicit opts.port) pins the port — no range walk. */
  exact: boolean;
}

/** Load the reins config from ~/.reins, creating the dir if absent. */
export function loadOrCreateConfig(opts: { home?: string; port?: number } = {}): ReinsConfig {
  const dir = join(opts.home ?? homedir(), ".reins");
  mkdirSync(dir, { recursive: true });

  if (typeof opts.port === "number") return { dir, port: opts.port, exact: true };

  const env = Number(process.env.REINS_PORT);
  if (process.env.REINS_PORT && Number.isInteger(env) && env > 0) {
    return { dir, port: env, exact: true };
  }

  return { dir, port: recordedPort(dir) ?? DEFAULT_PORT, exact: false };
}

function recordedPort(dir: string): number | undefined {
  try {
    const n = Number(readFileSync(join(dir, "port"), "utf8").trim());
    return Number.isInteger(n) && n > 0 && n < 65536 ? n : undefined;
  } catch {
    return undefined;
  }
}

/** Record the port the server actually bound — read back on the next start
 *  (sticky ports) and by status tooling. */
export function recordPort(dir: string, port: number): void {
  writeFileSync(join(dir, "port"), String(port));
}

/** Ports to try, preferred first: the sticky/default port, then the shared
 *  discovery range. An exact (REINS_PORT) config never walks. */
export function candidatePorts(cfg: ReinsConfig): number[] {
  if (cfg.exact) return [cfg.port];
  return [...new Set([cfg.port, ...portCandidates()])];
}
