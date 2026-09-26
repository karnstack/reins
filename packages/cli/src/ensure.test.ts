import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { DaemonHealth } from "./cli-commands.js";
import {
  ensureDaemon,
  type FoundDaemon,
  findDaemon,
  isOlderVersion,
  restartDaemon,
  stopDaemon,
  waitForBrowsers,
  wantsRestart,
} from "./ensure.js";
import { lockPath } from "./lock.js";
import { lowerPortRival } from "./serve.js";
import { packageVersion } from "./version.js";

const health = (browsers = 0, version = packageVersion()): DaemonHealth => ({
  ok: true,
  version,
  paired: browsers > 0,
  browsers: Array.from({ length: browsers }, (_, i) => ({
    id: `b${i + 1}`,
    browser: "Chrome",
    connectedAt: 0,
  })),
});

// A real dir so the default (uninjected) lock has somewhere to live.
const cfg = { dir: mkdtempSync(join(tmpdir(), "reins-ensure-")), port: 8765, exact: false };
afterAll(() => rmSync(cfg.dir, { recursive: true, force: true }));

/** Lock stub that records whether stop/spawn ran inside it. */
function fakeLock() {
  let held = false;
  const events: string[] = [];
  const lock = async <T>(fn: () => Promise<T>): Promise<T> => {
    held = true;
    events.push("lock");
    try {
      return await fn();
    } finally {
      held = false;
      events.push("unlock");
    }
  };
  return { lock, events, inside: (what: string) => events.push(held ? what : `${what}:UNLOCKED`) };
}

describe("ensureDaemon", () => {
  it("reuses a live daemon without spawning — and without taking the lock", async () => {
    const spawn = vi.fn();
    const { lock, events } = fakeLock();
    const found: FoundDaemon = { port: 8766, health: health(1) };
    const result = await ensureDaemon(cfg, { spawn, lock, find: async () => found });
    expect(result).toEqual({ ...found, spawned: false });
    expect(spawn).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });

  it("spawns under the lock and polls until the daemon answers", async () => {
    const { lock, events, inside } = fakeLock();
    let calls = 0;
    const find = async () => (++calls >= 4 ? { port: 8765, health: health() } : undefined);
    const result = await ensureDaemon(cfg, { spawn: () => inside("spawn"), lock, find, pollMs: 1 });
    expect(result.spawned).toBe(true);
    expect(result.port).toBe(8765);
    expect(events).toEqual(["lock", "spawn", "unlock"]);
  });

  it("uses the real lockfile by default and releases it", async () => {
    let spawned = false;
    const find = async () => (spawned ? { port: 8765, health: health() } : undefined);
    const spawn = () => {
      // The lock is held while we spawn.
      expect(existsSync(lockPath(cfg.dir))).toBe(true);
      spawned = true;
    };
    const result = await ensureDaemon(cfg, { spawn, find, pollMs: 1 });
    expect(result.spawned).toBe(true);
    expect(existsSync(lockPath(cfg.dir))).toBe(false);
  });

  it("does not spawn when the re-find under the lock shows a daemon (parallel CLI won)", async () => {
    const spawn = vi.fn();
    let calls = 0;
    // No daemon on the lock-free look, but one by the time the lock is held.
    const find = async () => (++calls >= 2 ? { port: 8765, health: health() } : undefined);
    const result = await ensureDaemon(cfg, { spawn, lock: (fn) => fn(), find });
    // Fresh from the other CLI: the caller should wait for the extension.
    expect(result).toMatchObject({ port: 8765, spawned: true });
    expect(spawn).not.toHaveBeenCalled();
  });

  it("errors when the spawned daemon never becomes healthy", async () => {
    await expect(
      ensureDaemon(cfg, { spawn: () => {}, find: async () => undefined, pollMs: 1, timeoutMs: 10 }),
    ).rejects.toThrow("daemon failed to start — check `reins logs`");
    expect(existsSync(lockPath(cfg.dir))).toBe(false);
  });
});

describe("ensureDaemon version check", () => {
  it("restarts a daemon older than the CLI, stop and spawn under the lock", async () => {
    const { lock, events, inside } = fakeLock();
    const notice = vi.fn();
    let calls = 0;
    // Old daemon on the lock-free look and on the re-find; new one after spawn.
    const find = async (): Promise<FoundDaemon> =>
      ++calls <= 2
        ? { port: 8765, health: health(1, "0.4.0") }
        : { port: 8765, health: health(0, "0.5.0") };
    const result = await ensureDaemon(cfg, {
      version: "0.5.0",
      find,
      lock,
      stop: async (port) => void inside(`stop:${port}`),
      spawn: () => inside("spawn"),
      notice,
      pollMs: 1,
    });
    expect(events).toEqual(["lock", "stop:8765", "spawn", "unlock"]);
    expect(result).toMatchObject({ spawned: true, health: { version: "0.5.0" } });
    expect(notice).toHaveBeenCalledWith("reins: daemon runs v0.4.0, CLI is v0.5.0 — restarting it");
  });

  it("leaves a newer daemon alone (two installed CLIs must not bounce it)", async () => {
    const stop = vi.fn(async () => {});
    const found: FoundDaemon = { port: 8765, health: health(1, "0.6.0") };
    const result = await ensureDaemon(cfg, { version: "0.5.0", find: async () => found, stop });
    expect(result.spawned).toBe(false);
    expect(stop).not.toHaveBeenCalled();
  });

  it("does not stop a daemon someone else already restarted (re-find under lock)", async () => {
    // Two CLIs see the v0.4.0 daemon; the other one restarts it first. By the
    // time we hold the lock, port 8765 is the fresh v0.5.0 — killing it would
    // be the TOCTOU bug.
    const stop = vi.fn(async () => {});
    const spawn = vi.fn();
    const notice = vi.fn();
    let calls = 0;
    const find = async (): Promise<FoundDaemon> =>
      ++calls === 1
        ? { port: 8765, health: health(1, "0.4.0") }
        : { port: 8765, health: health(1, "0.5.0") };
    const result = await ensureDaemon(cfg, {
      version: "0.5.0",
      find,
      lock: (fn) => fn(),
      stop,
      spawn,
      notice,
    });
    expect(result).toMatchObject({ port: 8765, spawned: true, health: { version: "0.5.0" } });
    expect(stop).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
    expect(notice).not.toHaveBeenCalled();
  });

  it("keeps using the old daemon when it won't stop, with a warning", async () => {
    const spawn = vi.fn();
    const notice = vi.fn();
    const found: FoundDaemon = { port: 8765, health: health(1, "0.4.0") };
    const result = await ensureDaemon(cfg, {
      version: "0.5.0",
      find: async () => found,
      lock: (fn) => fn(),
      stop: async () => {
        throw new Error("reins daemon on port 8765 did not stop — check `reins logs`");
      },
      spawn,
      notice,
    });
    expect(result).toEqual({ ...found, spawned: false });
    expect(spawn).not.toHaveBeenCalled();
    expect(notice).toHaveBeenLastCalledWith(
      "reins: could not restart the v0.4.0 daemon — using it as-is (`reins restart` / `reins logs`)",
    );
  });

  it.each([
    ["daemon", "0.0.0", "0.5.0"],
    ["CLI", "0.4.0", "0.0.0"],
  ])("never restarts when the %s version is unknown (0.0.0)", async (_, daemon, cli) => {
    const stop = vi.fn(async () => {});
    const spawn = vi.fn();
    const found: FoundDaemon = { port: 8765, health: health(1, daemon) };
    const result = await ensureDaemon(cfg, {
      version: cli,
      find: async () => found,
      lock: (fn) => fn(),
      stop,
      spawn,
    });
    expect(result).toEqual({ ...found, spawned: false });
    expect(stop).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
  });
});

describe("isOlderVersion", () => {
  it("compares major.minor.patch numerically", () => {
    expect(isOlderVersion("0.4.0", "0.5.0")).toBe(true);
    expect(isOlderVersion("0.9.0", "0.10.0")).toBe(true);
    expect(isOlderVersion("1.0.0", "0.10.0")).toBe(false);
    expect(isOlderVersion("0.5.0", "0.5.0")).toBe(false);
    expect(isOlderVersion("0.5.0-next.1", "0.5.0")).toBe(false);
  });

  it("treats garbage as 0.0.0 (pinned: never throws)", () => {
    expect(isOlderVersion("abc", "0.5.0")).toBe(true);
    expect(isOlderVersion("0.5.0", "abc")).toBe(false);
    expect(isOlderVersion("", "")).toBe(false);
    expect(isOlderVersion("1.x.2", "1.0.1")).toBe(false); // "x" → 0, so 1.0.2
  });
});

describe("wantsRestart", () => {
  it("restarts only an older daemon whose version (and ours) is known", () => {
    expect(wantsRestart("0.4.0", "0.5.0")).toBe(true);
    expect(wantsRestart("0.5.0", "0.5.0")).toBe(false);
    expect(wantsRestart("0.6.0", "0.5.0")).toBe(false);
    expect(wantsRestart("0.0.0", "0.5.0")).toBe(false);
    expect(wantsRestart("0.4.0", "0.0.0")).toBe(false);
    // Garbage parses as 0.0.0 too — no restart loop from an unparsable version.
    expect(wantsRestart("abc", "0.5.0")).toBe(true);
  });
});

describe("stopDaemon", () => {
  it("requests shutdown, then waits until the port stops answering", async () => {
    const shutdown = vi.fn(async () => {});
    let calls = 0;
    const probe = async (port: number) => (++calls < 3 ? { port, health: health() } : undefined);
    await stopDaemon(8765, { shutdown, probe, pollMs: 1 });
    expect(shutdown).toHaveBeenCalledWith(8765);
    expect(calls).toBe(3);
  });

  it("tolerates a rejected shutdown request (daemon died mid-request)", async () => {
    const shutdown = vi.fn(async () => {
      throw Object.assign(new Error("fetch failed"), { cause: { code: "ECONNRESET" } });
    });
    let calls = 0;
    const probe = async (port: number) => (++calls < 2 ? { port, health: health() } : undefined);
    await expect(stopDaemon(8765, { shutdown, probe, pollMs: 1 })).resolves.toBeUndefined();
    expect(calls).toBe(2);
  });

  it("still errors when shutdown rejects but the daemon keeps answering", async () => {
    const shutdown = async () => {
      throw new Error("fetch failed");
    };
    const probe = async (port: number) => ({ port, health: health() });
    await expect(stopDaemon(8765, { shutdown, probe, pollMs: 1, timeoutMs: 10 })).rejects.toThrow(
      "did not stop",
    );
  });

  it("errors when the daemon never goes away", async () => {
    const probe = async (port: number) => ({ port, health: health() });
    await expect(
      stopDaemon(8765, { shutdown: async () => {}, probe, pollMs: 1, timeoutMs: 10 }),
    ).rejects.toThrow("did not stop");
  });
});

describe("findDaemon", () => {
  it("prefers the lowest live port (the one lowerPortRival lets survive)", async () => {
    // Sticky port 8767 is probed first, but a spawn race left 8765 live too —
    // 8767 is about to bow out, so it must not be the answer.
    const live = new Set([8767, 8765, 8770]);
    const probe = async (port: number) => (live.has(port) ? { port, health: health() } : undefined);
    const found = await findDaemon({ ...cfg, port: 8767 }, probe);
    expect(found?.port).toBe(8765);
  });

  it("returns undefined when nothing answers", async () => {
    expect(await findDaemon(cfg, async () => undefined)).toBeUndefined();
  });
});

describe("restartDaemon", () => {
  it("stops the live daemon, spawns a fresh one, and reports the old one", async () => {
    const { lock, events, inside } = fakeLock();
    let stopped = false;
    const find = async (): Promise<FoundDaemon | undefined> =>
      stopped
        ? events.includes("spawn")
          ? { port: 8765, health: health(0) }
          : undefined
        : { port: 8766, health: health(1, "0.4.0") };
    const result = await restartDaemon(cfg, {
      find,
      lock,
      stop: async (port) => {
        inside(`stop:${port}`);
        stopped = true;
      },
      spawn: () => inside("spawn"),
      pollMs: 1,
    });
    expect(events).toEqual(["lock", "stop:8766", "spawn", "unlock"]);
    expect(result.previous?.health.version).toBe("0.4.0");
    expect(result.current).toMatchObject({ port: 8765, spawned: true });
  });

  it("fails loudly when the daemon won't stop (explicit restart, unlike ensureDaemon)", async () => {
    const spawn = vi.fn();
    await expect(
      restartDaemon(cfg, {
        find: async () => ({ port: 8765, health: health(1) }),
        stop: async () => {
          throw new Error("reins daemon on port 8765 did not stop — check `reins logs`");
        },
        spawn,
      }),
    ).rejects.toThrow("did not stop");
    expect(spawn).not.toHaveBeenCalled();
    expect(existsSync(lockPath(cfg.dir))).toBe(false);
  });

  it("just spawns when nothing was running", async () => {
    const stop = vi.fn(async () => {});
    let spawned = false;
    const find = async () => (spawned ? { port: 8765, health: health() } : undefined);
    const result = await restartDaemon(cfg, {
      find,
      stop,
      spawn: () => {
        spawned = true;
      },
      pollMs: 1,
    });
    expect(stop).not.toHaveBeenCalled();
    expect(result.previous).toBeUndefined();
    expect(result.current.spawned).toBe(true);
  });
});

describe("waitForBrowsers", () => {
  it("resolves as soon as a browser appears", async () => {
    let calls = 0;
    const probe = async (port: number): Promise<FoundDaemon> => ({
      port,
      health: health(++calls >= 2 ? 1 : 0),
    });
    const h = await waitForBrowsers(8765, { probe, pollMs: 1 });
    expect(h.browsers).toHaveLength(1);
  });

  it("with connectedAfter, ignores a connection that predates it", async () => {
    // After a reload the old connection can still be listed for a moment.
    let calls = 0;
    const probe = async (port: number): Promise<FoundDaemon> => {
      const h = health(1);
      h.browsers[0] = {
        id: calls++ >= 2 ? "b2" : "b1",
        browser: "Chrome",
        connectedAt: calls >= 3 ? 200 : 50,
      };
      return { port, health: h };
    };
    const h = await waitForBrowsers(8765, { probe, pollMs: 1, connectedAfter: 100 });
    expect(h.browsers[0]?.id).toBe("b2");
  });

  it("with browser, ignores a fresh connection from a different browser", async () => {
    // Reloading Chrome while Brave happens to reconnect: Brave isn't the answer.
    let calls = 0;
    const probe = async (port: number): Promise<FoundDaemon> => {
      calls++;
      const browsers = [{ id: "b3", browser: "Brave", connectedAt: 200 }];
      if (calls >= 3) browsers.push({ id: "b4", browser: "Chrome", connectedAt: 300 });
      return { port, health: { ...health(0), browsers } };
    };
    const h = await waitForBrowsers(8765, {
      probe,
      pollMs: 1,
      connectedAfter: 100,
      browser: "Chrome",
    });
    expect(h.browsers.map((b) => b.id)).toContain("b4");
    expect(calls).toBe(3);
  });

  it("times out with the extension hint", async () => {
    const probe = async (port: number): Promise<FoundDaemon> => ({ port, health: health(0) });
    await expect(waitForBrowsers(8765, { probe, pollMs: 1, timeoutMs: 5 })).rejects.toThrow(
      "no browser connected — is the reins extension installed?",
    );
  });
});

describe("lowerPortRival", () => {
  const ports = [8765, 8766, 8767, 8768];

  it("finds a live daemon on a lower port", async () => {
    const probe = async (port: number) => (port === 8765 ? { port, health: health() } : undefined);
    expect(await lowerPortRival(ports, 8767, probe)).toBe(8765);
  });

  it("ignores daemons on higher ports (they bow out, not us)", async () => {
    const probe = async (port: number) => (port === 8768 ? { port, health: health() } : undefined);
    expect(await lowerPortRival(ports, 8766, probe)).toBeUndefined();
  });

  it("returns undefined when alone", async () => {
    expect(await lowerPortRival(ports, 8765, async () => undefined)).toBeUndefined();
  });
});
