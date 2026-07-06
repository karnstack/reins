import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { BrowserInfo, Tab } from "@reins/protocol";
import type { ToolCommand } from "./commands.js";
import type { ReinsConfig } from "./config.js";

export interface DaemonHealth {
  ok: boolean;
  version: string;
  paired: boolean;
  browsers: BrowserInfo[];
}

/** Usage text for `reins help` / unknown commands. */
export function helpText(version: string, tools: Record<string, ToolCommand>): string {
  const width = Math.max(...Object.keys(tools).map((n) => n.length), "browsers".length) + 2;
  const line = (name: string, summary: string) => `  ${name.padEnd(width)}${summary}`;
  const tool = (name: string) => {
    const t = tools[name];
    return t ? line(name, t.summary) : `  ${name}`;
  };
  return [
    `reins ${version} — drive your real browser from the shell`,
    "",
    "Usage: reins <command> [flags]",
    "",
    "Tabs & pages:",
    ...["tabs", "open", "close", "focus", "nav"].map(tool),
    "",
    "Interaction:",
    ...[
      "snapshot",
      "click",
      "type",
      "fill",
      "select",
      "press",
      "hover",
      "scroll",
      "upload",
      "wait",
      "dialog",
      "resize",
    ].map(tool),
    "",
    "Reading:",
    ...["text", "screenshot", "console", "network"].map(tool),
    "",
    "Advanced:",
    ...["eval", "cdp"].map(tool),
    line("daemon", "run the daemon in the foreground (normally auto-spawned)"),
    "",
    "Management:",
    line("browsers", "list browsers connected to the daemon"),
    line("status", "daemon state, port, connected browsers"),
    line("extension", "install the extension without the Chrome Web Store (load unpacked)"),
    line("allow <id>", "allow an unpacked/dev extension to connect"),
    line("kill", "stop the background daemon"),
    line("doctor", "run diagnostic checks"),
    line("logs", "show the daemon log location and recent lines"),
    line("help [command]", "this help, or a command's usage"),
    "",
    "Shared flags: --tab <id> (default: active tab), --browser <id> (needed",
    "only when several browsers are connected; ids come from `reins tabs`),",
    "--json (raw result). The daemon starts on demand; nothing to set up.",
  ].join("\n");
}

/** Human status lines for `reins status`. */
export function healthSummary(h: DaemonHealth | undefined, port: number): string {
  if (!h) {
    return [
      `daemon : not running (no reins daemon answered on the candidate ports around ${port})`,
      "         it starts on demand — any tool command (e.g. `reins tabs`) spawns it",
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
      detail: health
        ? `running (v${health.version})`
        : "not running — starts on demand (`reins tabs`), or run `reins daemon`",
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

/** Locate the newest log file (by mtime — filenames span naming eras) and
 *  its last `lines` lines. */
export function logsInfo(dir: string, lines = 20): LogsInfo {
  let files: string[];
  try {
    files = readdirSync(dir)
      .filter((f) => f.endsWith(".log"))
      .map((f) => ({ f, mtime: statSync(join(dir, f)).mtimeMs }))
      .sort((a, b) => a.mtime - b.mtime)
      .map(({ f }) => f);
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
