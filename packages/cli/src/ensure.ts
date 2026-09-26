import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { BrowserInfo } from "@reins/protocol";
import type { DaemonHealth } from "./cli-commands.js";
import { candidatePorts, type ReinsConfig } from "./config.js";
import { packageVersion } from "./version.js";

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

/** True when semver `a` is older than `b` (major.minor.patch; pre-release tags ignored). */
export function isOlderVersion(a: string, b: string): boolean {
  const parts = (v: string) =>
    v
      .split("-")[0]
      ?.split(".")
      .map((n) => Number(n) || 0) ?? [];
  const [pa, pb] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0;
  }
  return false;
}

function requestShutdown(port: number): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}/shutdown`, {
    method: "POST",
    signal: AbortSignal.timeout(3000),
  });
}

/**
 * Ask a daemon to shut down and wait until its port stops answering, so a
 * follow-up spawn can't race the dying process for the port.
 */
export async function stopDaemon(
  port: number,
  opts: {
    shutdown?: (port: number) => Promise<unknown>;
    probe?: (port: number) => Promise<FoundDaemon | undefined>;
    pollMs?: number;
    timeoutMs?: number;
  } = {},
): Promise<void> {
  const probe = opts.probe ?? probeHealth;
  await (opts.shutdown ?? requestShutdown)(port);
  const pollMs = opts.pollMs ?? 100;
  const deadline = Date.now() + (opts.timeoutMs ?? 4000);
  while (Date.now() < deadline) {
    if (!(await probe(port))) return;
    await sleep(pollMs);
  }
  throw new Error(`reins daemon on port ${port} did not stop — check \`reins logs\``);
}

export interface EnsuredDaemon extends FoundDaemon {
  /** True when this call had to spawn the daemon (extension may still be reconnecting). */
  spawned: boolean;
}

interface SpawnOpts {
  spawn?: () => void;
  find?: (cfg: ReinsConfig) => Promise<FoundDaemon | undefined>;
  pollMs?: number;
  timeoutMs?: number;
}

/** Spawn a detached daemon and wait for /health. */
async function spawnAndWait(cfg: ReinsConfig, opts: SpawnOpts): Promise<EnsuredDaemon> {
  const find = opts.find ?? findDaemon;
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
 * Make sure a daemon is running: reuse the live one, else spawn it detached
 * and wait for /health. A live daemon older than this CLI (left over from
 * before an `npm i -g` upgrade) is restarted so it runs the installed code.
 * Only older: a newer daemon is left alone, so two installed CLI versions
 * can't bounce it back and forth.
 */
export async function ensureDaemon(
  cfg: ReinsConfig,
  opts: SpawnOpts & {
    /** This CLI's version (default: package.json). */
    version?: string;
    stop?: (port: number) => Promise<void>;
    notice?: (msg: string) => void;
  } = {},
): Promise<EnsuredDaemon> {
  const find = opts.find ?? findDaemon;
  const existing = await find(cfg);
  if (existing) {
    const version = opts.version ?? packageVersion();
    if (!isOlderVersion(existing.health.version, version)) return { ...existing, spawned: false };
    (opts.notice ?? console.error)(
      `reins: daemon runs v${existing.health.version}, CLI is v${version} — restarting it`,
    );
    await (opts.stop ?? stopDaemon)(existing.port);
  }
  return spawnAndWait(cfg, opts);
}

/**
 * `reins restart`: stop the live daemon (if any) and spawn a fresh one.
 * `previous` is what was running before, for the old → new version line.
 */
export async function restartDaemon(
  cfg: ReinsConfig,
  opts: SpawnOpts & { stop?: (port: number) => Promise<void> } = {},
): Promise<{ previous?: FoundDaemon; current: EnsuredDaemon }> {
  const previous = await (opts.find ?? findDaemon)(cfg);
  if (previous) await (opts.stop ?? stopDaemon)(previous.port);
  const current = await spawnAndWait(cfg, opts);
  return previous ? { previous, current } : { current };
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
    /** Only count browsers that connected after this time (epoch ms). */
    connectedAfter?: number;
    /** Only count browsers with this name (e.g. "Google Chrome"). */
    browser?: string;
  } = {},
): Promise<DaemonHealth> {
  const probe = opts.probe ?? probeHealth;
  const pollMs = opts.pollMs ?? 500;
  const after = opts.connectedAfter ?? Number.NEGATIVE_INFINITY;
  const deadline = Date.now() + (opts.timeoutMs ?? 15_000);
  for (;;) {
    const found = await probe(port);
    const counts = (b: BrowserInfo) =>
      b.connectedAt > after && (opts.browser === undefined || b.browser === opts.browser);
    if (found?.health.browsers.some(counts)) return found.health;
    if (Date.now() >= deadline) {
      throw new Error("no browser connected — is the reins extension installed? (`reins status`)");
    }
    await sleep(pollMs);
  }
}
