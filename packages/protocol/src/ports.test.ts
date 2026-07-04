import { describe, expect, it } from "vitest";
import { DEFAULT_PORT, PORT_RANGE, portCandidates } from "./ports.js";

describe("portCandidates", () => {
  it("starts at the default port and covers the range", () => {
    const ports = portCandidates();
    expect(ports).toHaveLength(PORT_RANGE);
    expect(ports[0]).toBe(DEFAULT_PORT);
    expect(ports.at(-1)).toBe(DEFAULT_PORT + PORT_RANGE - 1);
  });
});
