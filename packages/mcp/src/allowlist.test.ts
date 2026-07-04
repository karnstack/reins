import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { allowExtension, loadAllowedOrigins } from "./allowlist.js";

const VALID_ID = "a".repeat(32);
const OTHER_ID = "b".repeat(32);

function dir() {
  return mkdtempSync(join(tmpdir(), "reins-allow-"));
}

describe("loadAllowedOrigins", () => {
  it("returns only built-ins when the file is absent", () => {
    const origins = loadAllowedOrigins(dir());
    for (const o of origins) expect(o).toMatch(/^chrome-extension:\/\//);
  });

  it("includes ids from allowed-extensions, skipping blanks and comments", () => {
    const d = dir();
    writeFileSync(join(d, "allowed-extensions"), `${VALID_ID}\n\n# comment\n${OTHER_ID}\n`);
    const origins = loadAllowedOrigins(d);
    expect(origins.has(`chrome-extension://${VALID_ID}`)).toBe(true);
    expect(origins.has(`chrome-extension://${OTHER_ID}`)).toBe(true);
    expect(origins.has("chrome-extension://# comment")).toBe(false);
  });
});

describe("allowExtension", () => {
  it("appends a valid id and is idempotent", () => {
    const d = dir();
    allowExtension(d, VALID_ID);
    allowExtension(d, VALID_ID);
    const content = readFileSync(join(d, "allowed-extensions"), "utf8");
    expect(content.match(new RegExp(VALID_ID, "g"))).toHaveLength(1);
    expect(loadAllowedOrigins(d).has(`chrome-extension://${VALID_ID}`)).toBe(true);
  });

  it("rejects malformed ids", () => {
    expect(() => allowExtension(dir(), "not-an-id")).toThrow(/invalid extension id/);
    expect(() => allowExtension(dir(), "z".repeat(32))).toThrow(/invalid extension id/);
  });
});
