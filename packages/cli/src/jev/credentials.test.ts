import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearKey, credentialsPath, keyStatus, readKey, writeKey } from "./credentials.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "reins-creds-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

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

  it("treats a corrupt file as no key", () => {
    writeFileSync(credentialsPath(dir), "{not json");
    expect(readKey(dir)).toBeUndefined();
  });
});
