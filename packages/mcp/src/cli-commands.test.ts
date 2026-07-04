import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  browsersText,
  claudeInstallArgs,
  codexSnippet,
  doctorReport,
  healthSummary,
  helpText,
  installText,
  logsInfo,
  mcpJsonSnippet,
  tabsText,
} from "./cli-commands.js";
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

describe("install snippets", () => {
  it("claudeInstallArgs registers the HTTP endpoint at user scope", () => {
    expect(claudeInstallArgs(8765).join(" ")).toBe(
      "mcp add --transport http reins http://127.0.0.1:8765/mcp --scope user",
    );
  });

  it("codexSnippet points at the /mcp URL and mentions the stdio fallback", () => {
    expect(codexSnippet(8765)).toContain("http://127.0.0.1:8765/mcp");
    expect(codexSnippet(8765)).toContain('"serve", "--stdio"');
  });

  it("mcpJsonSnippet parses and targets /mcp", () => {
    const parsed = JSON.parse(mcpJsonSnippet(8766)) as {
      mcpServers: { reins: { type: string; url: string } };
    };
    expect(parsed.mcpServers.reins.type).toBe("http");
    expect(parsed.mcpServers.reins.url).toBe("http://127.0.0.1:8766/mcp");
  });

  it("installText mentions every client path", () => {
    const text = installText(8765);
    expect(text).toContain("claude");
    expect(text).toContain("config.toml");
    expect(text).toContain("mcpServers");
  });
});

describe("helpText", () => {
  it("lists the commands and version", () => {
    const text = helpText("1.2.3");
    expect(text).toContain("1.2.3");
    for (const cmd of [
      "up",
      "down",
      "restart",
      "serve",
      "install",
      "allow",
      "browsers",
      "tabs",
      "status",
      "doctor",
      "logs",
    ]) {
      expect(text).toContain(cmd);
    }
    expect(text).not.toContain("pair");
  });
});

describe("healthSummary", () => {
  it("reports a running daemon with its browsers", () => {
    const s = healthSummary(HEALTH, 8765);
    expect(s).toContain("running");
    expect(s).toContain("0.2.0");
    expect(s).toContain("Chrome");
  });

  it("reports a stopped daemon with the fix", () => {
    const s = healthSummary(undefined, 8765);
    expect(s).toContain("not running");
    expect(s).toContain("reins up");
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
    writeFileSync(join(dir, "mcp-2026-01-01.log"), "old\n");
    writeFileSync(join(dir, "mcp-2026-01-02.log"), "one\ntwo\nthree\n");
    const info = logsInfo(dir, 2);
    expect(info.latest).toContain("mcp-2026-01-02.log");
    expect(info.tail).toEqual(["two", "three"]);
  });
});
