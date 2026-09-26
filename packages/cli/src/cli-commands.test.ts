import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  browsersText,
  doctorReport,
  groupsText,
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
  version: "0.1.0",
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

  it("help mentions extension --reload", () => {
    expect(helpText("1.2.3", TOOL_COMMANDS)).toMatch(/--reload: re-stage, then reload an unpacked/);
  });

  it("help lists the audit command", () => {
    expect(helpText("1.2.3", TOOL_COMMANDS)).toContain("audit");
  });
});

describe("healthSummary", () => {
  it("reports a running daemon with its browsers", () => {
    const s = healthSummary(HEALTH, 8765);
    expect(s).toContain("running");
    expect(s).toContain("0.1.0");
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

describe("groupsText", () => {
  it("renders one line per group", () => {
    const g = {
      groupId: 7,
      title: "reins",
      color: "blue" as const,
      collapsed: true,
      windowId: 1,
      tabCount: 2,
      browserId: "b1",
    };
    expect(groupsText([g])).toBe('  b1  group 7  "reins"  blue  2 tabs  (collapsed)  window 1');
    expect(groupsText([{ ...g, collapsed: false, tabCount: 1 }])).toBe(
      '  b1  group 7  "reins"  blue  1 tab  window 1',
    );
    expect(groupsText([])).toBe("(no groups)");
  });

  it("lists skipped browsers after the groups, one line per reason", () => {
    const g = {
      groupId: 7,
      title: "reins",
      color: "blue" as const,
      collapsed: false,
      windowId: 1,
      tabCount: 1,
      browserId: "b1",
    };
    const skipped = [
      { browserId: "b2", browser: "Dia", reason: "unsupported" as const, message: "Dia (b2) ..." },
      { browserId: "b3", browser: "Arc", reason: "outdated" as const, message: "old" },
      { browserId: "b4", browser: "Brave", reason: "error" as const, message: "timed out" },
    ];
    expect(groupsText([g], skipped)).toBe(
      [
        '  b1  group 7  "reins"  blue  1 tab  window 1',
        "  b2  Dia — tab groups not supported",
        "  b3  Arc — reins extension too old for tab groups (update it)",
        "  b4  Brave — failed: timed out",
      ].join("\n"),
    );
    expect(groupsText([], skipped.slice(0, 1))).toBe(
      "(no groups)\n  b2  Dia — tab groups not supported",
    );
    expect(groupsText([], [])).toBe("(no groups)");
  });

  it("tabsText marks grouped tabs", () => {
    const text = tabsText([
      { tabId: 12, title: "T", url: "https://x", active: true, groupId: 7, browserId: "b1" },
    ]);
    expect(text).toBe("  b1  tab 12 *  g7  T — https://x");
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
