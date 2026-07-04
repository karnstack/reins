import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  claudeInstallArgs,
  codexSnippet,
  doctorReport,
  helpText,
  installText,
  logsInfo,
  mcpJsonSnippet,
  pairText,
} from "./cli-commands.js";
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

describe("install snippets", () => {
  it("claudeInstallArgs registers via npx at user scope", () => {
    const args = claudeInstallArgs();
    expect(args).toContain("reins");
    expect(args).toContain("--scope");
    expect(args.join(" ")).toContain("npx -y reins-mcp");
  });

  it("codexSnippet is a TOML mcp_servers block", () => {
    expect(codexSnippet()).toContain("[mcp_servers.reins]");
    expect(codexSnippet()).toContain("reins-mcp");
  });

  it("mcpJsonSnippet parses as JSON with an mcpServers.reins entry", () => {
    const parsed = JSON.parse(mcpJsonSnippet()) as {
      mcpServers: { reins: { command: string; args: string[] } };
    };
    expect(parsed.mcpServers.reins.command).toBe("npx");
    expect(parsed.mcpServers.reins.args).toContain("reins-mcp");
  });

  it("installText mentions every client path", () => {
    const text = installText();
    expect(text).toContain("claude");
    expect(text).toContain("config.toml");
    expect(text).toContain("mcpServers");
  });
});

describe("helpText", () => {
  it("lists the commands and version", () => {
    const text = helpText("1.2.3");
    expect(text).toContain("1.2.3");
    for (const cmd of ["install", "pair", "status", "doctor", "logs"]) {
      expect(text).toContain(cmd);
    }
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
