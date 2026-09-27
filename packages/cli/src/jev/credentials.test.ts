import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearKey, credentialsPath, keyStatus, readKey, writeKey } from "./credentials.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "reins-creds-"));
});
afterEach(() => {
  chmodSync(dir, 0o700);
  rmSync(dir, { recursive: true, force: true });
});

describe("credentials file", () => {
  it("reports not set when there is no file", () => {
    expect(readKey(dir)).toBeUndefined();
    expect(keyStatus(dir)).toEqual({ provider: "typesafe", set: false });
  });

  it("writes the key readable only by the user, and reads it back", () => {
    writeKey(dir, "ts_live_abcd1234");
    expect(readKey(dir)).toBe("ts_live_abcd1234");
    expect(statSync(credentialsPath(dir)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(credentialsPath(dir), "utf8"))).toEqual({
      typesafe: "ts_live_abcd1234",
    });
  });

  it("status shows only the last 4 characters", () => {
    writeKey(dir, "ts_live_abcd1234");
    expect(keyStatus(dir)).toEqual({ provider: "typesafe", set: true, last4: "1234" });
  });

  it("replacing leaves no temp file behind", () => {
    writeKey(dir, "ts_first_11111111");
    writeKey(dir, "ts_second_2222222");
    expect(readKey(dir)).toBe("ts_second_2222222");
    expect(existsSync(`${credentialsPath(dir)}.${process.pid}.tmp`)).toBe(false);
  });

  it("clear removes the file", () => {
    writeKey(dir, "ts_live_abcd1234");
    clearKey(dir);
    expect(existsSync(credentialsPath(dir))).toBe(false);
    expect(readKey(dir)).toBeUndefined();
  });

  it('a corrupt file is unreadable, not silently "not set", and is never echoed', () => {
    writeFileSync(credentialsPath(dir), '{not json "ts_live_secret"');
    for (const f of [() => readKey(dir), () => keyStatus(dir), () => writeKey(dir, "k")]) {
      expect(f).toThrow(/credentials\.json is not valid JSON/);
      expect(f).toThrow(/fix or delete it/);
      let message = "";
      try {
        f();
      } catch (err) {
        message = (err as Error).message;
      }
      expect(message).not.toContain("secret");
      expect(message).not.toContain("{not json");
    }
  });

  it("a file that isn't JSON at the top level is unreadable too", () => {
    writeFileSync(credentialsPath(dir), "[]");
    expect(() => readKey(dir)).toThrow(/not valid JSON/);
  });

  it("removes its temp file when the rename fails", () => {
    mkdirSync(credentialsPath(dir)); // a directory in the way: rename over it fails
    expect(() => writeKey(dir, "ts_live_abcd1234")).toThrow();
    expect(readdirSync(dir).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });

  it.skipIf(process.getuid?.() === 0)("clear surfaces an unlink failure other than ENOENT", () => {
    writeKey(dir, "ts_live_abcd1234");
    chmodSync(dir, 0o500); // the file can be read but not unlinked
    expect(() => clearKey(dir)).toThrow(/EACCES|EPERM/);
    chmodSync(dir, 0o700);
    expect(readKey(dir)).toBe("ts_live_abcd1234");
  });

  it("clear removes a corrupt file: it is the documented remedy", () => {
    writeFileSync(credentialsPath(dir), "{not json");
    clearKey(dir);
    expect(existsSync(credentialsPath(dir))).toBe(false);
    expect(readKey(dir)).toBeUndefined();
  });

  it("clear with no file is fine", () => {
    expect(() => clearKey(dir)).not.toThrow();
  });
});
