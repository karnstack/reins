import { describe, expect, it, vi } from "vitest";
import { UsageError } from "./args.js";
import { KEY_USAGE, runKey } from "./key-cli.js";

const deps = (status: unknown, secret = "ts_live_abcd1234") => ({
  rpc: vi.fn(async () => status),
  readSecret: vi.fn(async () => secret),
});

describe("reins key", () => {
  it("set reads the key without echo, saves it, and says what gets sent", async () => {
    const d = deps({ provider: "typesafe", set: true, last4: "1234" });
    const out = await runKey(["set", "typesafe"], d);
    expect(d.readSecret).toHaveBeenCalled();
    expect(d.rpc).toHaveBeenCalledWith("key_set", {
      provider: "typesafe",
      key: "ts_live_abcd1234",
    });
    expect(out).toContain("typesafe: set (••••1234)");
    expect(out).toContain("sends page text");
  });

  it("provider defaults to typesafe", async () => {
    const d = deps({ provider: "typesafe", set: false });
    expect(await runKey(["status"], d)).toBe("typesafe: not set");
    expect(d.rpc).toHaveBeenCalledWith("key_status", { provider: "typesafe" });
  });

  it("clear removes it", async () => {
    const d = deps({ provider: "typesafe", set: false });
    expect(await runKey(["clear"], d)).toBe("typesafe: key removed");
  });

  it("refuses an empty key", async () => {
    await expect(runKey(["set"], deps({}, "   "))).rejects.toThrow("no key given");
  });

  it("rejects unknown subcommands and providers", async () => {
    await expect(runKey([], deps({}))).rejects.toThrow(UsageError);
    await expect(runKey(["set", "openai"], deps({}))).rejects.toThrow(KEY_USAGE);
  });
});
