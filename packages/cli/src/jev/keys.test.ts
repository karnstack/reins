import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readKey } from "./credentials.js";
import { createKeyService } from "./keys.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "reins-keys-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("key service", () => {
  it("validates, then stores, and returns only the status", async () => {
    const validate = vi.fn(async () => {});
    const keys = createKeyService({ dir, validate });
    const status = await keys.handle("key_set", { key: "ts_live_abcd1234" });
    expect(validate).toHaveBeenCalledWith("ts_live_abcd1234");
    expect(status).toEqual({ provider: "typesafe", set: true, last4: "1234" });
    expect(readKey(dir)).toBe("ts_live_abcd1234");
  });

  it("writes nothing when validation fails", async () => {
    const keys = createKeyService({
      dir,
      validate: async () => {
        throw new Error("TypeSafe rejected the API key");
      },
    });
    await expect(keys.handle("key_set", { key: "ts_bad_12345678" })).rejects.toThrow("rejected");
    expect(readKey(dir)).toBeUndefined();
  });

  it("reports status and clears", async () => {
    const keys = createKeyService({ dir, validate: async () => {} });
    expect(await keys.handle("key_status", {})).toEqual({ provider: "typesafe", set: false });
    await keys.handle("key_set", { key: "ts_live_abcd1234" });
    expect(await keys.handle("key_clear", {})).toEqual({ provider: "typesafe", set: false });
  });

  it("rejects other methods", async () => {
    const keys = createKeyService({ dir, validate: async () => {} });
    await expect(keys.handle("click", {})).rejects.toThrow("unknown key method");
  });
});
