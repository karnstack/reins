import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  browsersText,
  doctorReport,
  healthSummary,
  helpText,
  logsInfo,
  tabsText,
} from "./cli-commands.js";
import { TOOL_COMMANDS } from "./commands.js";
import { loadOrCreateConfig } from "./config.js";

function cfg() {
  return loadOrCreateConfig({ home: mkdtempSync(join(tmpdir(), "reins-cli-")) });
}

const HEALTH = {
  ok: true,
  version: "0.2.0",
  paired: true,
  browsers: [{ id: "b1", browser: "Chrome", connectedAt: 0 }],
};

describe("helpText", () => {
  it("lists every tool command, the management commands, and the version", () => {
    const text = helpText("1.2.3", TOOL_COMMANDS);
    expect(text).toContain("1.2.3");
    for (const name of Object.keys(TOOL_COMMANDS)) {
      expect(text, name).toContain(name);
    }
    for (const cmd of ["browsers", "status", "allow", "kill", "doctor", "logs", "daemon"]) {
      expect(text).toContain(cmd);
    }
    for (const gone of ["reins up", "install claude", "--stdio", "restart"]) {
      expect(text, gone).not.toContain(gone);
    }
  });
});

describe("healthSummary", () => {
  it("reports a running daemon with its browsers", () => {
    const s = healthSummary(HEALTH, 8765);
    expect(s).toContain("running");
    expect(s).toContain("0.2.0");
    expect(s).toContain("Chrome");
  });

  it("reports a stopped daemon and that it starts on demand", () => {
    const s = healthSummary(undefined, 8765);
    expect(s).toContain("not running");
    expect(s).toContain("on demand");
  });
});

describe("browsersText / tabsText", () => {
  it("renders the browser roster", () => {
    const text = browsersText(HEALTH.browsers);
    expect(text).toContain("b1");
    expect(text).toContain("Chrome");
    expect(browsersText([])).toContain("no browsers");
  });

  it("renders tabs with browser tags and active markers", () => {
    const text = tabsText([
      { tabId: 3, title: "Home", url: "https://x", active: true, browserId: "b1" },
      { tabId: 4, title: "", url: "https://y", active: false, browserId: "b2" },
    ]);
    expect(text).toContain("b1");
    expect(text).toContain("tab 3 *");
    expect(text).toContain("(untitled)");
    expect(tabsText([])).toContain("no tabs");
  });
});

describe("doctorReport", () => {
  it("passes all checks with a healthy daemon and a browser", () => {
    const report = doctorReport(cfg(), HEALTH);
    expect(report.ok).toBe(true);
    expect(report.checks.find((c) => c.name === "daemon")?.ok).toBe(true);
    expect(report.checks.find((c) => c.name === "browser")?.ok).toBe(true);
  });

  it("fails the daemon and browser checks when nothing is running", () => {
    const report = doctorReport(cfg(), undefined);
    expect(report.ok).toBe(false);
    expect(report.checks.find((c) => c.name === "daemon")?.ok).toBe(false);
  });
});

describe("logsInfo", () => {
  it("returns an empty tail when the dir does not exist", () => {
    const info = logsInfo(join(tmpdir(), "reins-definitely-missing"));
    expect(info.latest).toBeUndefined();
    expect(info.tail).toEqual([]);
  });

  it("tails the newest log file", () => {
    const dir = mkdtempSync(join(tmpdir(), "reins-logs-"));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "daemon-2026-01-02.log"), "one\ntwo\nthree\n");
    // A leftover file from the old naming era sorts later alphabetically but
    // is older by mtime — mtime must win.
    writeFileSync(join(dir, "mcp-2026-01-01.log"), "old\n");
    utimesSync(join(dir, "mcp-2026-01-01.log"), new Date(0), new Date(0));
    const info = logsInfo(dir, 2);
    expect(info.latest).toContain("daemon-2026-01-02.log");
    expect(info.tail).toEqual(["two", "three"]);
  });
});
