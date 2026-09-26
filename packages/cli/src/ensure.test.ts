import { describe, expect, it, vi } from "vitest";
import type { DaemonHealth } from "./cli-commands.js";
import {
  ensureDaemon,
  type FoundDaemon,
  isOlderVersion,
  restartDaemon,
  stopDaemon,
  waitForBrowsers,
} from "./ensure.js";
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

const cfg = { dir: "/tmp/nowhere", port: 8765, exact: false };

describe("ensureDaemon", () => {
  it("reuses a live daemon without spawning", async () => {
    const spawn = vi.fn();
    const found: FoundDaemon = { port: 8766, health: health(1) };
    const result = await ensureDaemon(cfg, { spawn, find: async () => found });
    expect(result).toEqual({ ...found, spawned: false });
    expect(spawn).not.toHaveBeenCalled();
  });

  it("spawns and polls until the daemon answers", async () => {
    const spawn = vi.fn();
    let calls = 0;
    const find = async () => (++calls >= 3 ? { port: 8765, health: health() } : undefined);
    const result = await ensureDaemon(cfg, { spawn, find, pollMs: 1 });
    expect(result.spawned).toBe(true);
    expect(result.port).toBe(8765);
    expect(spawn).toHaveBeenCalledOnce();
  });

  it("errors when the spawned daemon never becomes healthy", async () => {
    await expect(
      ensureDaemon(cfg, { spawn: () => {}, find: async () => undefined, pollMs: 1, timeoutMs: 10 }),
    ).rejects.toThrow("daemon failed to start — check `reins logs`");
  });
});

describe("ensureDaemon version check", () => {
  it("restarts a daemon older than the CLI", async () => {
    const stop = vi.fn(async () => {});
    const spawn = vi.fn();
    const notice = vi.fn();
    let calls = 0;
    const find = async (): Promise<FoundDaemon> =>
      ++calls === 1
        ? { port: 8765, health: health(1, "0.4.0") }
        : { port: 8765, health: health(0, "0.5.0") };
    const result = await ensureDaemon(cfg, {
      version: "0.5.0",
      find,
      stop,
      spawn,
      notice,
      pollMs: 1,
    });
    expect(stop).toHaveBeenCalledWith(8765);
    expect(spawn).toHaveBeenCalledOnce();
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
});

describe("isOlderVersion", () => {
  it("compares major.minor.patch numerically", () => {
    expect(isOlderVersion("0.4.0", "0.5.0")).toBe(true);
    expect(isOlderVersion("0.9.0", "0.10.0")).toBe(true);
    expect(isOlderVersion("1.0.0", "0.10.0")).toBe(false);
    expect(isOlderVersion("0.5.0", "0.5.0")).toBe(false);
    expect(isOlderVersion("0.5.0-next.1", "0.5.0")).toBe(false);
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

  it("errors when the daemon never goes away", async () => {
    const probe = async (port: number) => ({ port, health: health() });
    await expect(
      stopDaemon(8765, { shutdown: async () => {}, probe, pollMs: 1, timeoutMs: 10 }),
    ).rejects.toThrow("did not stop");
  });
});

describe("restartDaemon", () => {
  it("stops the live daemon, spawns a fresh one, and reports the old one", async () => {
    const order: string[] = [];
    let stopped = false;
    const find = async (): Promise<FoundDaemon | undefined> =>
      stopped
        ? order.includes("spawn")
          ? { port: 8765, health: health(0) }
          : undefined
        : { port: 8766, health: health(1, "0.4.0") };
    const result = await restartDaemon(cfg, {
      find,
      stop: async (port) => {
        order.push(`stop:${port}`);
        stopped = true;
      },
      spawn: () => order.push("spawn"),
      pollMs: 1,
    });
    expect(order).toEqual(["stop:8766", "spawn"]);
    expect(result.previous?.health.version).toBe("0.4.0");
    expect(result.current).toMatchObject({ port: 8765, spawned: true });
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
