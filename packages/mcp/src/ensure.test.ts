import { describe, expect, it, vi } from "vitest";
import type { DaemonHealth } from "./cli-commands.js";
import { ensureDaemon, type FoundDaemon, waitForBrowsers } from "./ensure.js";
import { lowerPortRival } from "./serve.js";

const health = (browsers = 0): DaemonHealth => ({
  ok: true,
  version: "0.0.0",
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
    const probe = async (port: number) =>
      port === 8765 ? { port, health: health() } : undefined;
    expect(await lowerPortRival(ports, 8767, probe)).toBe(8765);
  });

  it("ignores daemons on higher ports (they bow out, not us)", async () => {
    const probe = async (port: number) =>
      port === 8768 ? { port, health: health() } : undefined;
    expect(await lowerPortRival(ports, 8766, probe)).toBeUndefined();
  });

  it("returns undefined when alone", async () => {
    expect(await lowerPortRival(ports, 8765, async () => undefined)).toBeUndefined();
  });
});
