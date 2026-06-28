import { describe, expect, it } from "vitest";
import { HelloFrame } from "./frames.js";

describe("HelloFrame", () => {
  it("accepts a valid hello frame", () => {
    const frame = HelloFrame.parse({ type: "hello", token: "abc123", browser: "chrome" });
    expect(frame.token).toBe("abc123");
    expect(frame.type).toBe("hello");
  });

  it("rejects a hello frame with an empty token", () => {
    expect(() => HelloFrame.parse({ type: "hello", token: "", browser: "chrome" })).toThrow();
  });

  it("rejects a hello frame missing the token", () => {
    expect(() => HelloFrame.parse({ type: "hello", browser: "chrome" })).toThrow();
  });
});
