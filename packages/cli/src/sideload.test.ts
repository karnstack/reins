import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadAllowedOrigins } from "./allowlist.js";
import {
  extractExtension,
  SIDELOAD_EXTENSION_ID,
  SIDELOAD_PUBLIC_KEY,
  sideloadInstructions,
} from "./sideload.js";

/** Chrome's id derivation: sha256 of the SPKI DER public key, first 16 bytes
 *  as hex, each nibble mapped 0-f → a-p. */
function chromeExtensionId(publicKeyBase64: string): string {
  const hex = createHash("sha256")
    .update(Buffer.from(publicKeyBase64, "base64"))
    .digest("hex")
    .slice(0, 32);
  return [...hex].map((c) => "abcdefghijklmnop"[Number.parseInt(c, 16)]).join("");
}

describe("sideload identity", () => {
  it("the committed id matches the committed public key", () => {
    expect(chromeExtensionId(SIDELOAD_PUBLIC_KEY)).toBe(SIDELOAD_EXTENSION_ID);
  });

  it("is allowlisted out of the box (no allow-file needed)", () => {
    const dir = mkdtempSync(join(tmpdir(), "reins-sideload-"));
    try {
      expect(loadAllowedOrigins(dir)).toContain(`chrome-extension://${SIDELOAD_EXTENSION_ID}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("extractExtension", () => {
  const dirs: string[] = [];
  const tmp = () => {
    const d = mkdtempSync(join(tmpdir(), "reins-extract-"));
    dirs.push(d);
    return d;
  };
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it("copies the bundle, replacing a previous extract entirely", () => {
    const source = tmp();
    writeFileSync(join(source, "manifest.json"), "{}");
    mkdirSync(join(source, "assets"));
    writeFileSync(join(source, "assets", "chunk-new.js"), "new");

    const target = join(tmp(), "extension");
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, "chunk-stale.js"), "old");

    extractExtension(source, target);

    expect(readFileSync(join(target, "assets", "chunk-new.js"), "utf8")).toBe("new");
    expect(existsSync(join(target, "chunk-stale.js"))).toBe(false);
  });

  it("throws a pointer to RUNNING.md when there is no bundle", () => {
    const source = tmp();
    const target = join(tmp(), "extension");
    expect(() => extractExtension(source, target)).toThrow(/RUNNING\.md/);
  });
});

describe("sideloadInstructions", () => {
  it("names the target and never mentions reins allow", () => {
    const text = sideloadInstructions("/home/u/.reins/extension");
    expect(text).toContain("/home/u/.reins/extension");
    expect(text).toContain("Load unpacked");
    expect(text).not.toContain("reins allow");
  });
});
