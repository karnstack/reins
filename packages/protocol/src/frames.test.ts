import { describe, expect, it } from "vitest";
import { HelloFrame } from "./frames.js";

describe("HelloFrame", () => {
  it("parses a tokenless hello", () => {
    const parsed = HelloFrame.safeParse({ type: "hello", browser: "chrome" });
    expect(parsed.success).toBe(true);
  });

  it("ignores a legacy token field (non-strict object)", () => {
    const parsed = HelloFrame.safeParse({ type: "hello", browser: "chrome", token: "old" });
    expect(parsed.success).toBe(true);
    expect((parsed.data as Record<string, unknown>).token).toBeUndefined();
  });

  it("carries the extension's version when it sends one", () => {
    const parsed = HelloFrame.safeParse({ type: "hello", browser: "chrome", version: "0.4.0" });
    expect(parsed.success && parsed.data.version).toBe("0.4.0");
  });

  it("rejects a missing browser", () => {
    expect(HelloFrame.safeParse({ type: "hello" }).success).toBe(false);
  });
});
