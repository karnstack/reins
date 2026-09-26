import { closeSync, openSync, readFileSync, statSync, unlinkSync, writeSync } from "node:fs";
import { join } from "node:path";

/**
 * Best-effort lockfile that serialises daemon stop/spawn across parallel CLIs.
 * `{pid, at}` lives in `<dir>/daemon.lock`; the file's existence is the lock
 * (created with "wx", so creation is atomic). A lock is stale when its owner
 * is dead or it's older than `staleMs` — then it's removed and retried.
 */

export interface LockOpts {
  /** Give up waiting after this long (default 10s). */
  timeoutMs?: number;
  /** Retry interval while another process holds the lock (default 75ms). */
  pollMs?: number;
  /** Locks older than this are presumed abandoned (default 15s). */
  staleMs?: number;
  /** Where to report a timed-out acquire (default: stderr). */
  notice?: (msg: string) => void;
}

export function lockPath(dir: string): string {
  return join(dir, "daemon.lock");
}

/** True when a process with this pid exists (EPERM = exists but not ours). */
export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

function readLock(path: string): { pid?: number; at?: number } | undefined {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as { pid?: number; at?: number }) : {};
  } catch {
    return undefined;
  }
}

/** Stale = older than `staleMs`, or held by a pid that no longer exists. */
export function isStaleLock(path: string, staleMs: number, now = Date.now()): boolean {
  let mtime: number;
  try {
    mtime = statSync(path).mtimeMs;
  } catch {
    return false; // gone already — nothing to remove
  }
  const lock = readLock(path);
  const at = typeof lock?.at === "number" ? lock.at : mtime;
  if (now - at > staleMs) return true;
  // Unparsable (e.g. caught mid-write) — leave it to the age check.
  return typeof lock?.pid === "number" && !isPidAlive(lock.pid);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function errCode(err: unknown): string | undefined {
  return (err as NodeJS.ErrnoException | undefined)?.code;
}

/** Create the lockfile; false when it couldn't be had in time (or at all). */
async function acquire(path: string, opts: Required<Omit<LockOpts, "notice">>): Promise<boolean> {
  const deadline = Date.now() + opts.timeoutMs;
  for (;;) {
    try {
      const fd = openSync(path, "wx");
      writeSync(fd, JSON.stringify({ pid: process.pid, at: Date.now() }));
      closeSync(fd);
      return true;
    } catch (err) {
      // Anything but "already exists" (missing dir, read-only fs): don't lock.
      if (errCode(err) !== "EEXIST") return false;
    }
    if (isStaleLock(path, opts.staleMs)) {
      try {
        unlinkSync(path);
      } catch {}
    }
    if (Date.now() >= deadline) return false;
    await sleep(opts.pollMs);
  }
}

/** Remove the lockfile, but only if it's still ours (a stale-sweep may have replaced it). */
function release(path: string): void {
  if (readLock(path)?.pid !== process.pid) return;
  try {
    unlinkSync(path);
  } catch {}
}

/**
 * Run `fn` holding `<dir>/daemon.lock`. If the lock can't be acquired within
 * `timeoutMs`, `fn` still runs (after a notice) — a stuck CLI is worse than
 * an unlocked spawn.
 */
export async function withDaemonLock<T>(
  dir: string,
  fn: () => Promise<T>,
  opts: LockOpts = {},
): Promise<T> {
  const path = lockPath(dir);
  const held = await acquire(path, {
    timeoutMs: opts.timeoutMs ?? 10_000,
    pollMs: opts.pollMs ?? 75,
    staleMs: opts.staleMs ?? 15_000,
  });
  if (!held) {
    (opts.notice ?? console.error)(
      `reins: could not take ${path} (another reins command may be starting the daemon) — proceeding without it`,
    );
    return fn();
  }
  try {
    return await fn();
  } finally {
    release(path);
  }
}
