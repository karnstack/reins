import { describe, expect, it } from "vitest";
import { nextBackoff } from "./backoff.js";

describe("nextBackoff", () => {
  it("grows exponentially from the base delay", () => {
    expect(nextBackoff(0)).toBe(500);
    expect(nextBackoff(1)).toBe(1000);
    expect(nextBackoff(2)).toBe(2000);
  });

  it("caps at the maximum delay", () => {
    expect(nextBackoff(20)).toBe(5_000);
  });
});
