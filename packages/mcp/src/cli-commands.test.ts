import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { doctorReport, pairText } from "./cli-commands.js";
import { loadOrCreateConfig } from "./config.js";

function cfg() {
  return loadOrCreateConfig({ home: mkdtempSync(join(tmpdir(), "reins-cli-")) });
}

describe("pairText", () => {
  it("prints the ws url and token", () => {
    const c = cfg();
    const out = pairText(c);
    expect(out).toContain(`ws://127.0.0.1:${c.port}`);
    expect(out).toContain(c.token);
  });
});

describe("doctorReport", () => {
  it("passes its checks for a freshly created config", () => {
    const report = doctorReport(cfg());
    expect(report.ok).toBe(true);
    expect(report.checks.find((c) => c.name === "token")?.ok).toBe(true);
    expect(report.checks.find((c) => c.name === "port")?.ok).toBe(true);
  });
});
