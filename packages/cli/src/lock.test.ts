import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isPidAlive, isStaleLock, lockPath, withDaemonLock } from "./lock.js";

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "reins-lock-"));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A pid that certainly existed and certainly doesn't any more. */
function deadPid(): number {
  const child = spawnSync(process.execPath, ["-e", "0"]);
  if (child.pid === undefined || child.pid === 0) throw new Error("no child pid");
  return child.pid;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe("isPidAlive", () => {
  it("is true for ourselves and false for an exited process", () => {
    expect(isPidAlive(process.pid)).toBe(true);
    expect(isPidAlive(deadPid())).toBe(false);
  });
});

describe("withDaemonLock", () => {
  it("creates the lockfile with our pid while fn runs, and removes it after", async () => {
    const dir = tmp();
    const path = lockPath(dir);
    const result = await withDaemonLock(dir, async () => {
      const lock = JSON.parse(readFileSync(path, "utf8")) as { pid: number; at: number };
      expect(lock.pid).toBe(process.pid);
      expect(typeof lock.at).toBe("number");
      return "done";
    });
    expect(result).toBe("done");
    expect(existsSync(path)).toBe(false);
  });

  it("releases the lock when fn throws", async () => {
    const dir = tmp();
    await expect(
      withDaemonLock(dir, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(existsSync(lockPath(dir))).toBe(false);
  });

  it("serialises two holders: the second waits for the first to release", async () => {
    const dir = tmp();
    const events: string[] = [];
    const first = withDaemonLock(dir, async () => {
      events.push("a:start");
      await sleep(40);
      events.push("a:end");
    });
    await sleep(5);
    const second = withDaemonLock(
      dir,
      async () => {
        events.push("b:start");
      },
      { pollMs: 5 },
    );
    await Promise.all([first, second]);
    expect(events).toEqual(["a:start", "a:end", "b:start"]);
  });

  it("sweeps a lock whose owner is dead", async () => {
    const dir = tmp();
    writeFileSync(lockPath(dir), JSON.stringify({ pid: deadPid(), at: Date.now() }));
    const notice = vi.fn();
    let ran = false;
    await withDaemonLock(
      dir,
      async () => {
        ran = true;
        const lock = JSON.parse(readFileSync(lockPath(dir), "utf8")) as { pid: number };
        expect(lock.pid).toBe(process.pid);
      },
      { pollMs: 5, timeoutMs: 500, notice },
    );
    expect(ran).toBe(true);
    expect(notice).not.toHaveBeenCalled();
    expect(existsSync(lockPath(dir))).toBe(false);
  });

  it("sweeps a lock older than staleMs even if its owner is alive", async () => {
    const dir = tmp();
    writeFileSync(lockPath(dir), JSON.stringify({ pid: process.pid, at: Date.now() - 60_000 }));
    const notice = vi.fn();
    let ran = false;
    await withDaemonLock(
      dir,
      async () => {
        ran = true;
      },
      { pollMs: 5, timeoutMs: 500, staleMs: 15_000, notice },
    );
    expect(ran).toBe(true);
    expect(notice).not.toHaveBeenCalled();
  });

  it("gives up after timeoutMs and runs fn anyway, leaving the other lock alone", async () => {
    const dir = tmp();
    const theirs = JSON.stringify({ pid: process.pid, at: Date.now() });
    writeFileSync(lockPath(dir), theirs);
    const notice = vi.fn();
    const result = await withDaemonLock(dir, async () => "ran", {
      pollMs: 5,
      timeoutMs: 30,
      notice,
    });
    expect(result).toBe("ran");
    expect(notice).toHaveBeenCalledOnce();
    expect(notice.mock.calls[0]?.[0]).toMatch(/could not take .*daemon\.lock/);
    expect(readFileSync(lockPath(dir), "utf8")).toBe(theirs);
  });

  it("runs fn without a lock when the dir doesn't exist", async () => {
    const notice = vi.fn();
    const result = await withDaemonLock(join(tmp(), "missing"), async () => 1, { notice });
    expect(result).toBe(1);
    expect(notice).toHaveBeenCalledOnce();
  });
});

describe("isStaleLock", () => {
  it("is false for a fresh lock held by a live pid", () => {
    const dir = tmp();
    writeFileSync(lockPath(dir), JSON.stringify({ pid: process.pid, at: Date.now() }));
    expect(isStaleLock(lockPath(dir), 15_000)).toBe(false);
  });

  it("is true past staleMs, or for a dead pid", () => {
    const dir = tmp();
    const path = lockPath(dir);
    writeFileSync(path, JSON.stringify({ pid: process.pid, at: 1000 }));
    expect(isStaleLock(path, 15_000, 20_000)).toBe(true);
    writeFileSync(path, JSON.stringify({ pid: deadPid(), at: Date.now() }));
    expect(isStaleLock(path, 15_000)).toBe(true);
  });

  it("leaves an unparsable (mid-write) lock to the age check", () => {
    const dir = tmp();
    writeFileSync(lockPath(dir), "");
    expect(isStaleLock(lockPath(dir), 15_000)).toBe(false);
    expect(isStaleLock(lockPath(dir), 15_000, Date.now() + 60_000)).toBe(true);
  });

  it("is false when the file is already gone", () => {
    expect(isStaleLock(join(tmp(), "daemon.lock"), 15_000)).toBe(false);
  });
});
