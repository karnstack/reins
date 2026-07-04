import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReinsConfig } from "./config.js";

/** Human-readable pairing instructions for `reins pair`. */
export function pairText(cfg: ReinsConfig): string {
  return [
    "reins pairing",
    "",
    `  WebSocket URL : ws://127.0.0.1:${cfg.port}`,
    `  Token        : ${cfg.token}`,
    "",
    "Paste both into the reins extension popup to connect this browser.",
  ].join("\n");
}

export interface DoctorReport {
  checks: Array<{ name: string; ok: boolean; detail: string }>;
  ok: boolean;
}

/** Diagnostic checks for `reins doctor`. */
export function doctorReport(cfg: ReinsConfig): DoctorReport {
  const checks = [
    { name: "config-dir", ok: cfg.dir.length > 0, detail: cfg.dir },
    { name: "token", ok: cfg.token.length >= 43, detail: `${cfg.token.length} chars` },
    { name: "port", ok: Number.isInteger(cfg.port) && cfg.port > 0, detail: String(cfg.port) },
    { name: "node", ok: process.versions.node.length > 0, detail: `v${process.versions.node}` },
  ];
  return { checks, ok: checks.every((c) => c.ok) };
}

/** argv for `claude mcp add` that registers reins for all projects. */
export function claudeInstallArgs(): string[] {
  return ["mcp", "add", "reins", "--scope", "user", "--", "npx", "-y", "reins-mcp"];
}

/** Codex config snippet (~/.codex/config.toml). */
export function codexSnippet(): string {
  return ["[mcp_servers.reins]", 'command = "npx"', 'args = ["-y", "reins-mcp"]'].join("\n");
}

/** Generic MCP JSON config snippet (Cursor, Windsurf, claude_desktop_config.json, …). */
export function mcpJsonSnippet(): string {
  return JSON.stringify(
    { mcpServers: { reins: { command: "npx", args: ["-y", "reins-mcp"] } } },
    null,
    2,
  );
}

/** Overview printed by `reins install` with no client argument. */
export function installText(): string {
  return [
    "Register the reins MCP server with your agent:",
    "",
    "  Claude Code   reins install claude",
    `                (runs: claude ${claudeInstallArgs().join(" ")})`,
    "",
    "  Codex         add to ~/.codex/config.toml:",
    ...codexSnippet()
      .split("\n")
      .map((l) => `                ${l}`),
    "",
    "  Other MCP clients (JSON config):",
    ...mcpJsonSnippet()
      .split("\n")
      .map((l) => `                ${l}`),
    "",
    "Then load the reins extension and run `reins pair` to connect the browser.",
  ].join("\n");
}

/** Usage text for `reins help` / unknown commands. */
export function helpText(version: string): string {
  return [
    `reins ${version} — drive your real browser from an MCP client`,
    "",
    "Usage: reins <command>",
    "",
    "Commands:",
    "  install [claude|codex]  register the MCP server with an agent",
    "  pair                    print the WebSocket URL + token for the extension popup",
    "  status                  show config, port, and whether a server is running",
    "  doctor                  run diagnostic checks",
    "  logs                    show the server log location and recent lines",
    "  help                    show this help",
    "",
    "Options:",
    "  -v, --version           print the version",
  ].join("\n");
}

export interface LogsInfo {
  dir: string;
  latest?: string;
  tail: string[];
}

/** Locate the newest log file and its last `lines` lines. */
export function logsInfo(dir: string, lines = 20): LogsInfo {
  let files: string[];
  try {
    files = readdirSync(dir)
      .filter((f) => f.endsWith(".log"))
      .sort();
  } catch {
    return { dir, tail: [] };
  }
  const latest = files.at(-1);
  if (!latest) return { dir, tail: [] };
  const path = join(dir, latest);
  try {
    const tail = readFileSync(path, "utf8").trimEnd().split("\n").slice(-lines);
    return { dir, latest: path, tail };
  } catch {
    return { dir, latest: path, tail: [] };
  }
}
