import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createLogger, logFilePath, logsDir } from "./log.js";

describe("logsDir", () => {
  it("lives under ~/.reins/logs", () => {
    expect(logsDir("/home/u")).toBe(join("/home/u", ".reins", "logs"));
  });
});

describe("logFilePath", () => {
  it("is dated by day", () => {
    const path = logFilePath("/x", new Date("2026-07-04T12:00:00Z"));
    expect(path).toBe(join("/x", "daemon-2026-07-04.log"));
  });
});

describe("createLogger", () => {
  it("writes the line to stderr and appends it to the dated file", () => {
    const dir = mkdtempSync(join(tmpdir(), "reins-log-"));
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    try {
      const log = createLogger(dir);
      log("hello world");
      log("second line");
    } finally {
      stderr.mockRestore();
    }
    const files = readdirSync(dir);
    expect(files).toHaveLength(1);
    const content = readFileSync(join(dir, files[0] as string), "utf8");
    expect(content).toContain("hello world");
    expect(content).toContain("second line");
    // ISO timestamp prefix
    expect(content).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("does not throw when the directory cannot be created", () => {
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    try {
      const log = createLogger("/dev/null/impossible");
      expect(() => log("still works")).not.toThrow();
    } finally {
      stderr.mockRestore();
    }
  });
});
