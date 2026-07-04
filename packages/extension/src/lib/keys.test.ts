import { describe, expect, it } from "vitest";
import { parseKeySpec } from "./keys.js";

describe("parseKeySpec", () => {
  it("parses named keys case-insensitively", () => {
    expect(parseKeySpec("Escape")).toEqual({
      key: "Escape",
      code: "Escape",
      keyCode: 27,
      modifiers: 0,
    });
    expect(parseKeySpec("enter").keyCode).toBe(13);
    expect(parseKeySpec("PageDown").code).toBe("PageDown");
    expect(parseKeySpec("space").key).toBe(" ");
  });

  it("parses single letters and digits", () => {
    expect(parseKeySpec("a")).toEqual({ key: "a", code: "KeyA", keyCode: 65, modifiers: 0 });
    expect(parseKeySpec("Z").code).toBe("KeyZ");
    expect(parseKeySpec("7")).toEqual({ key: "7", code: "Digit7", keyCode: 55, modifiers: 0 });
  });

  it("combines modifiers into the CDP bitmask", () => {
    expect(parseKeySpec("Meta+A").modifiers).toBe(4);
    expect(parseKeySpec("Ctrl+Shift+Tab").modifiers).toBe(2 | 8);
    expect(parseKeySpec("Alt+ArrowLeft").modifiers).toBe(1);
    expect(parseKeySpec("cmd+c").modifiers).toBe(4);
  });

  it("throws on unknown modifiers and keys", () => {
    expect(() => parseKeySpec("Hyper+A")).toThrow("unknown modifier: Hyper");
    expect(() => parseKeySpec("F13")).toThrow("unknown key: F13");
    expect(() => parseKeySpec("")).toThrow("unknown key");
  });
});
