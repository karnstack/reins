import type { ConsoleEntry, NetworkEntry } from "@reins/protocol";
import { describe, expect, it } from "vitest";
import { filterConsole, filterNetwork } from "./event-filter.js";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const consoleEntries: ConsoleEntry[] = [
  { level: "log", text: "msg A", timestamp: 100 },
  { level: "error", text: "msg B", timestamp: 200 },
  { level: "warn", text: "msg C", timestamp: 300 },
  { level: "info", text: "msg D", timestamp: 400 },
];

const networkEntries: NetworkEntry[] = [
  { method: "GET", url: "https://example.com/api/users", status: 200, timestamp: 100 },
  { method: "POST", url: "https://example.com/api/items", status: 201, timestamp: 200 },
  { method: "GET", url: "https://other.com/page", status: 404, timestamp: 300 },
];

// ─── filterConsole ─────────────────────────────────────────────────────────────

describe("filterConsole — sinceMs", () => {
  it("drops entries with timestamp strictly less than sinceMs", () => {
    const result = filterConsole(consoleEntries, { sinceMs: 200 });
    expect(result.map((e) => e.timestamp)).toEqual([200, 300, 400]);
  });

  it("keeps entries with timestamp equal to sinceMs", () => {
    const result = filterConsole(consoleEntries, { sinceMs: 100 });
    expect(result).toHaveLength(4);
  });

  it("keeps all entries when sinceMs is undefined", () => {
    const result = filterConsole(consoleEntries, {});
    expect(result).toHaveLength(4);
  });
});

describe("filterConsole — levels", () => {
  it("keeps only entries whose level is in the non-empty array", () => {
    const result = filterConsole(consoleEntries, { levels: ["error"] });
    expect(result).toHaveLength(1);
    expect(result[0]?.level).toBe("error");
  });

  it("empty levels array keeps all entries", () => {
    const result = filterConsole(consoleEntries, { levels: [] });
    expect(result).toHaveLength(4);
  });

  it("undefined levels keeps all entries", () => {
    const result = filterConsole(consoleEntries, {});
    expect(result).toHaveLength(4);
  });

  it("multiple levels keeps all matching entries", () => {
    const result = filterConsole(consoleEntries, { levels: ["log", "warn"] });
    expect(result.map((e) => e.level)).toEqual(["log", "warn"]);
  });
});

describe("filterConsole — combined", () => {
  it("sinceMs + levels applied together", () => {
    const result = filterConsole(consoleEntries, { sinceMs: 200, levels: ["error"] });
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ level: "error", text: "msg B", timestamp: 200 });
  });

  it("sinceMs + levels: no match returns empty array", () => {
    const result = filterConsole(consoleEntries, { sinceMs: 350, levels: ["error"] });
    expect(result).toHaveLength(0);
  });
});

// ─── filterNetwork ─────────────────────────────────────────────────────────────

describe("filterNetwork — sinceMs", () => {
  it("drops entries with timestamp strictly less than sinceMs", () => {
    const result = filterNetwork(networkEntries, { sinceMs: 200 });
    expect(result.map((e) => e.timestamp)).toEqual([200, 300]);
  });

  it("keeps all entries when sinceMs is undefined", () => {
    const result = filterNetwork(networkEntries, {});
    expect(result).toHaveLength(3);
  });
});

describe("filterNetwork — urlPattern", () => {
  it("keeps entries where url includes urlPattern (substring match)", () => {
    const result = filterNetwork(networkEntries, { urlPattern: "example.com" });
    expect(result).toHaveLength(2);
    expect(result.every((e) => e.url.includes("example.com"))).toBe(true);
  });

  it("drops entries where url does not include urlPattern", () => {
    const result = filterNetwork(networkEntries, { urlPattern: "other.com" });
    expect(result).toHaveLength(1);
    expect(result[0]?.url).toBe("https://other.com/page");
  });

  it("undefined urlPattern keeps all entries", () => {
    const result = filterNetwork(networkEntries, {});
    expect(result).toHaveLength(3);
  });
});

describe("filterNetwork — combined", () => {
  it("sinceMs + urlPattern applied together", () => {
    const result = filterNetwork(networkEntries, { sinceMs: 200, urlPattern: "example.com/api" });
    expect(result).toHaveLength(1);
    expect(result[0]?.url).toBe("https://example.com/api/items");
  });

  it("sinceMs + urlPattern: no match returns empty array", () => {
    const result = filterNetwork(networkEntries, { sinceMs: 400, urlPattern: "example.com" });
    expect(result).toHaveLength(0);
  });
});
