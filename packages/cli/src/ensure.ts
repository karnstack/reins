import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { BrowserInfo } from "@reins/protocol";
import type { DaemonHealth } from "./cli-commands.js";
import { candidatePorts, type ReinsConfig } from "./config.js";
import { withDaemonLock } from "./lock.js";
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

/**
 * Find the live daemon across the candidate ports (sticky port included).
 * Two daemons can briefly coexist after a spawn race; the lowest port wins
 * (see `lowerPortRival`), so prefer it over the one that's about to bow out.
 */
export async function findDaemon(
  cfg: ReinsConfig,
  probe: (port: number) => Promise<FoundDaemon | undefined> = probeHealth,
): Promise<FoundDaemon | undefined> {
  const results = await Promise.all(candidatePorts(cfg).map((p) => probe(p)));
  return results
    .filter((r): r is FoundDaemon => r !== undefined)
    .sort((a, b) => a.port - b.port)[0];
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

/** What `packageVersion()` reports when package.json can't be read. */
const UNKNOWN_VERSION = "0.0.0";

/**
 * Should a live daemon at `daemon` be restarted by a CLI at `cli`? Only when
 * it's older — a newer daemon is left alone so two installed CLI versions
 * can't bounce it back and forth — and never when either side is unknown
 * ("0.0.0" would restart on every command).
 */
export function wantsRestart(daemon: string, cli: string): boolean {
  if (daemon === UNKNOWN_VERSION || cli === UNKNOWN_VERSION) return false;
  return isOlderVersion(daemon, cli);
}

function requestShutdown(port: number): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}/shutdown`, {
    method: "POST",
    signal: AbortSignal.timeout(3000),
  });
}

/**
 * Ask a daemon to shut down and wait until its port stops answering, so a
 * follow-up spawn can't race the dying process for the port. A rejected
 * /shutdown (already gone, or died mid-request) is fine — the /health probe
 * is the source of truth; only "still answering at the deadline" is an error.
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
  await (opts.shutdown ?? requestShutdown)(port).catch(() => {});
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
  /** Serialises stop+spawn across parallel CLIs (default: `withDaemonLock` in cfg.dir). */
  lock?: <T>(fn: () => Promise<T>) => Promise<T>;
  notice?: (msg: string) => void;
}

function lockOf(cfg: ReinsConfig, opts: SpawnOpts): NonNullable<SpawnOpts["lock"]> {
  return opts.lock ?? ((fn) => withDaemonLock(cfg.dir, fn, { notice: opts.notice }));
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
 * before an `npm i -g` upgrade) is restarted so it runs the installed code
 * (see `wantsRestart` for when it isn't).
 *
 * The happy path — a usable daemon is up — is lock-free. Stop and spawn run
 * under the daemon lock, and the decision is re-made once it's held: a
 * parallel CLI may already have spawned or restarted the daemon, and a stale
 * "stop port P" would otherwise kill its fresh one.
 */
export async function ensureDaemon(
  cfg: ReinsConfig,
  opts: SpawnOpts & {
    /** This CLI's version (default: package.json). */
    version?: string;
    stop?: (port: number) => Promise<void>;
  } = {},
): Promise<EnsuredDaemon> {
  const find = opts.find ?? findDaemon;
  const notice = opts.notice ?? console.error;
  const version = opts.version ?? packageVersion();
  const usable = (d: FoundDaemon) => !wantsRestart(d.health.version, version);

  const existing = await find(cfg);
  if (existing && usable(existing)) return { ...existing, spawned: false };

  const lock = lockOf(cfg, opts);
  return lock(async () => {
    const current = await find(cfg);
    // A parallel CLI started this one while we waited on the lock: treat it
    // as fresh, so callers wait for the extension to reconnect.
    if (current && usable(current)) return { ...current, spawned: true };
    if (current) {
      const old = current.health.version;
      notice(`reins: daemon runs v${old}, CLI is v${version} — restarting it`);
      try {
        await (opts.stop ?? stopDaemon)(current.port);
      } catch {
        // Don't brick the command over a stubborn daemon; the user can force it.
        notice(
          `reins: could not restart the v${old} daemon — using it as-is (\`reins restart\` / \`reins logs\`)`,
        );
        return { ...current, spawned: false };
      }
    }
    return spawnAndWait(cfg, opts);
  });
}

/**
 * `reins restart`: stop the live daemon (if any) and spawn a fresh one.
 * `previous` is what was running before, for the old → new version line.
 * Unlike `ensureDaemon`, a daemon that won't stop is an error here.
 */
export async function restartDaemon(
  cfg: ReinsConfig,
  opts: SpawnOpts & { stop?: (port: number) => Promise<void> } = {},
): Promise<{ previous?: FoundDaemon; current: EnsuredDaemon }> {
  const lock = lockOf(cfg, opts);
  return lock(async () => {
    const previous = await (opts.find ?? findDaemon)(cfg);
    if (previous) await (opts.stop ?? stopDaemon)(previous.port);
    const current = await spawnAndWait(cfg, opts);
    return previous ? { previous, current } : { current };
  });
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
