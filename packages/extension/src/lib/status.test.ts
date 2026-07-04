import { describe, expect, it } from "vitest";
import { normalizeStatus } from "./status.js";

describe("normalizeStatus", () => {
  it("passes through 'connecting'", () => {
    expect(normalizeStatus("connecting")).toBe("connecting");
  });

  it("passes through 'connected'", () => {
    expect(normalizeStatus("connected")).toBe("connected");
  });

  it("maps the retired 'error' status → 'idle'", () => {
    expect(normalizeStatus("error")).toBe("idle");
  });

  it("maps 'disconnected' → 'idle'", () => {
    expect(normalizeStatus("disconnected")).toBe("idle");
  });

  it("maps undefined → 'idle'", () => {
    expect(normalizeStatus(undefined)).toBe("idle");
  });

  it("maps null → 'idle'", () => {
    expect(normalizeStatus(null)).toBe("idle");
  });

  it("maps an unknown string → 'idle'", () => {
    expect(normalizeStatus("bogus-status")).toBe("idle");
  });

  it("maps a non-string value → 'idle'", () => {
    expect(normalizeStatus(42)).toBe("idle");
  });
});
