import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { candidatePorts, loadOrCreateConfig, recordPort } from "./config.js";

afterEach(() => {
  delete process.env.REINS_PORT;
});

function home() {
  return mkdtempSync(join(tmpdir(), "reins-home-"));
}

describe("loadOrCreateConfig", () => {
  it("creates ~/.reins and defaults to port 8765 (not exact)", () => {
    const h = home();
    const cfg = loadOrCreateConfig({ home: h });
    expect(cfg.dir).toBe(join(h, ".reins"));
    expect(cfg.port).toBe(8765);
    expect(cfg.exact).toBe(false);
    expect(existsSync(cfg.dir)).toBe(true);
  });

  it("does not create a token file", () => {
    const cfg = loadOrCreateConfig({ home: home() });
    expect(existsSync(join(cfg.dir, "token"))).toBe(false);
  });

  it("prefers the recorded port (sticky, not exact)", () => {
    const h = home();
    const first = loadOrCreateConfig({ home: h });
    recordPort(first.dir, 8767);
    const cfg = loadOrCreateConfig({ home: h });
    expect(cfg.port).toBe(8767);
    expect(cfg.exact).toBe(false);
  });

  it("REINS_PORT forces an exact port", () => {
    process.env.REINS_PORT = "9999";
    const cfg = loadOrCreateConfig({ home: home() });
    expect(cfg.port).toBe(9999);
    expect(cfg.exact).toBe(true);
  });

  it("ignores a garbage port file", () => {
    const h = home();
    const cfg = loadOrCreateConfig({ home: h });
    writeFileSync(join(cfg.dir, "port"), "not-a-port");
    expect(loadOrCreateConfig({ home: h }).port).toBe(8765);
  });
});

describe("recordPort", () => {
  it("writes the bound port for the next start and for status tooling", () => {
    const cfg = loadOrCreateConfig({ home: home() });
    recordPort(cfg.dir, 8770);
    expect(readFileSync(join(cfg.dir, "port"), "utf8")).toBe("8770");
  });
});

describe("candidatePorts", () => {
  it("is just the port when exact", () => {
    expect(candidatePorts({ dir: "/x", port: 9999, exact: true })).toEqual([9999]);
  });

  it("walks the shared range, preferred port first, no duplicates", () => {
    const ports = candidatePorts({ dir: "/x", port: 8767, exact: false });
    expect(ports[0]).toBe(8767);
    expect(ports).toContain(8765);
    expect(new Set(ports).size).toBe(ports.length);
  });
});
