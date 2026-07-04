import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { BrowserInfo, Tab } from "@reins/protocol";
import type { ReinsConfig } from "./config.js";

export interface DaemonHealth {
  ok: boolean;
  version: string;
  paired: boolean;
  browsers: BrowserInfo[];
}

/** argv for `claude mcp add` that registers the daemon's HTTP endpoint for all projects. */
export function claudeInstallArgs(port: number): string[] {
  return [
    "mcp",
    "add",
    "--transport",
    "http",
    "reins",
    `http://127.0.0.1:${port}/mcp`,
    "--scope",
    "user",
  ];
}

/** Codex config snippet (~/.codex/config.toml). */
export function codexSnippet(port: number): string {
  return [
    "[mcp_servers.reins]",
    `url = "http://127.0.0.1:${port}/mcp"`,
    "",
    "# no HTTP support in your client? use stdio instead:",
    "# [mcp_servers.reins]",
    '# command = "npx"',
    '# args = ["-y", "@karnstack/reins", "serve", "--stdio"]',
  ].join("\n");
}

/** Generic MCP JSON config snippet (Cursor, Windsurf, claude_desktop_config.json, …). */
export function mcpJsonSnippet(port: number): string {
  return JSON.stringify(
    { mcpServers: { reins: { type: "http", url: `http://127.0.0.1:${port}/mcp` } } },
    null,
    2,
  );
}

/** Overview printed by `reins install` with no client argument. */
export function installText(port: number): string {
  return [
    "Register the reins MCP endpoint with your agent:",
    "",
    "  Claude Code   reins install claude",
    `                (runs: claude ${claudeInstallArgs(port).join(" ")})`,
    "",
    "  Codex         add to ~/.codex/config.toml:",
    ...codexSnippet(port)
      .split("\n")
      .map((l) => `                ${l}`),
    "",
    "  Other MCP clients (JSON config):",
    ...mcpJsonSnippet(port)
      .split("\n")
      .map((l) => `                ${l}`),
    "",
    "Then install the reins browser extension — it connects on its own.",
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
    "  up                      install + start the daemon (autostarts on login)",
    "  down                    stop the daemon and remove it from autostart",
    "  restart                 restart the daemon (e.g. after an upgrade)",
    "  serve [--stdio]         run the server in the foreground (stdio for HTTP-less clients)",
    "  install [claude|codex]  register the MCP endpoint with an agent",
    "  allow <extension-id>    allow an unpacked/dev extension to connect",
    "  browsers                list browsers connected to the daemon",
    "  tabs [browserId]        list tabs the daemon can reach",
    "  status                  daemon state, port, connected browsers",
    "  doctor                  run diagnostic checks",
    "  logs                    show the server log location and recent lines",
    "  help                    show this help",
    "",
    "Options:",
    "  -v, --version           print the version",
  ].join("\n");
}

/** Human status lines for `reins status`. */
export function healthSummary(h: DaemonHealth | undefined, port: number): string {
  if (!h) {
    return [
      `daemon : not running (no reins daemon answered on the candidate ports around ${port})`,
      "         start it with `reins up` (or `reins serve` in the foreground)",
    ].join("\n");
  }
  const lines = [`daemon : running on 127.0.0.1:${port} (v${h.version})`];
  if (h.browsers.length === 0) {
    lines.push(
      "browser: none connected — install the reins extension (or `reins allow <id>` for dev builds)",
    );
  } else {
    lines.push(`browser: ${h.browsers.length} connected`);
    lines.push(browsersText(h.browsers));
  }
  return lines.join("\n");
}

/** Roster for `reins browsers`. */
export function browsersText(browsers: BrowserInfo[]): string {
  if (browsers.length === 0) return "(no browsers connected)";
  return browsers
    .map((b) => `  ${b.id}  ${b.browser}  (connected ${new Date(b.connectedAt).toLocaleString()})`)
    .join("\n");
}

/** Tab listing for `reins tabs`. */
export function tabsText(tabs: Tab[]): string {
  if (tabs.length === 0) return "(no tabs)";
  return tabs
    .map(
      (t) =>
        `  ${t.browserId ?? "?"}  tab ${t.tabId}${t.active ? " *" : "  "}  ${t.title || "(untitled)"} — ${t.url}`,
    )
    .join("\n");
}

export interface DoctorReport {
  checks: Array<{ name: string; ok: boolean; detail: string }>;
  ok: boolean;
}

/** Diagnostic checks for `reins doctor`. */
export function doctorReport(cfg: ReinsConfig, health?: DaemonHealth): DoctorReport {
  const checks = [
    { name: "config-dir", ok: cfg.dir.length > 0, detail: cfg.dir },
    { name: "port", ok: Number.isInteger(cfg.port) && cfg.port > 0, detail: String(cfg.port) },
    { name: "node", ok: process.versions.node.length > 0, detail: `v${process.versions.node}` },
    {
      name: "daemon",
      ok: health !== undefined,
      detail: health ? `running (v${health.version})` : "not running — `reins up`",
    },
    {
      name: "browser",
      ok: (health?.browsers.length ?? 0) > 0,
      detail: health?.browsers.length
        ? `${health.browsers.length} connected`
        : "none connected — install the extension (dev builds need `reins allow`)",
    },
  ];
  return { checks, ok: checks.every((c) => c.ok) };
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
