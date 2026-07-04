import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { DaemonHealth } from "./cli-commands.js";
import { candidatePorts, type ReinsConfig } from "./config.js";

export interface FoundDaemon {
  port: number;
  health: DaemonHealth;
}

/** Probe one candidate port for a live reins daemon. */
export async function probeHealth(port: number): Promise<FoundDaemon | undefined> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(700),
    });
    if (!res.ok) return undefined;
    const health = (await res.json()) as DaemonHealth;
    return health.ok ? { port, health } : undefined;
  } catch {
    return undefined;
  }
}

/** Find the live daemon across the candidate ports (sticky port included). */
export async function findDaemon(cfg: ReinsConfig): Promise<FoundDaemon | undefined> {
  const results = await Promise.all(candidatePorts(cfg).map(probeHealth));
  return results.find((r) => r !== undefined);
}

/** Path to the bundled CLI entry (this module lands in dist/ next to cli.js). */
export function cliJsPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "cli.js");
}

/** Detached `reins daemon` — it logs to ~/.reins/logs on its own. */
export function spawnDaemon(): void {
  spawn(process.execPath, [cliJsPath(), "daemon"], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  }).unref();
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface EnsuredDaemon extends FoundDaemon {
  /** True when this call had to spawn the daemon (extension may still be reconnecting). */
  spawned: boolean;
}

/**
 * Make sure a daemon is running: reuse the live one, else spawn it detached
 * and wait for /health.
 */
export async function ensureDaemon(
  cfg: ReinsConfig,
  opts: {
    spawn?: () => void;
    find?: (cfg: ReinsConfig) => Promise<FoundDaemon | undefined>;
    pollMs?: number;
    timeoutMs?: number;
  } = {},
): Promise<EnsuredDaemon> {
  const find = opts.find ?? findDaemon;
  const existing = await find(cfg);
  if (existing) return { ...existing, spawned: false };

  (opts.spawn ?? spawnDaemon)();
  const pollMs = opts.pollMs ?? 150;
  const deadline = Date.now() + (opts.timeoutMs ?? 4000);
  while (Date.now() < deadline) {
    await sleep(pollMs);
    const found = await find(cfg);
    if (found) return { ...found, spawned: true };
  }
  throw new Error("reins daemon failed to start — check `reins logs`");
}

/**
 * Wait for at least one browser to appear on the daemon. Used after a fresh
 * spawn: the extension's reconnect backoff caps at 10s, so give it 15s.
 */
export async function waitForBrowsers(
  port: number,
  opts: {
    timeoutMs?: number;
    pollMs?: number;
    probe?: (port: number) => Promise<FoundDaemon | undefined>;
  } = {},
): Promise<DaemonHealth> {
  const probe = opts.probe ?? probeHealth;
  const pollMs = opts.pollMs ?? 500;
  const deadline = Date.now() + (opts.timeoutMs ?? 15_000);
  for (;;) {
    const found = await probe(port);
    if (found && found.health.browsers.length > 0) return found.health;
    if (Date.now() >= deadline) {
      throw new Error("no browser connected — is the reins extension installed? (`reins status`)");
    }
    await sleep(pollMs);
  }
}
