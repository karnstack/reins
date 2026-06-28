import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadOrCreateConfig } from "./config.js";

const homes: string[] = [];
function freshHome(): string {
  const h = mkdtempSync(join(tmpdir(), "reins-home-"));
  homes.push(h);
  return h;
}
afterEach(() => {
  delete process.env.REINS_PORT;
});

describe("loadOrCreateConfig", () => {
  it("generates a token and persists it across calls", () => {
    const home = freshHome();
    const a = loadOrCreateConfig({ home });
    expect(a.token.length).toBeGreaterThanOrEqual(43);
    const b = loadOrCreateConfig({ home });
    expect(b.token).toBe(a.token);
  });

  it("writes the token file with 0600 permissions", () => {
    const home = freshHome();
    const c = loadOrCreateConfig({ home });
    const mode = statSync(join(c.dir, "token")).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("defaults the port to 8765 and honors an explicit port", () => {
    const home = freshHome();
    expect(loadOrCreateConfig({ home }).port).toBe(8765);
    expect(loadOrCreateConfig({ home, port: 9001 }).port).toBe(9001);
  });

  it("reads the port from REINS_PORT when no explicit port is given", () => {
    const home = freshHome();
    process.env.REINS_PORT = "9100";
    expect(loadOrCreateConfig({ home }).port).toBe(9100);
  });
});
