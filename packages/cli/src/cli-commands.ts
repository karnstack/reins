import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { BrowserInfo, SkippedBrowser, Tab, TabGroup } from "@reins/protocol";
import type { ToolCommand } from "./commands.js";
import type { ReinsConfig } from "./config.js";
import { isOlderVersion, wantsRestart } from "./ensure.js";

export interface DaemonHealth {
  ok: boolean;
  version: string;
  paired: boolean;
  browsers: BrowserInfo[];
}

/** Usage text for `reins help` / unknown commands. */
/** A `fetch` to the daemon that hit its own deadline: say so in one line
 *  instead of undici's stack. Every other failure passes through. */
export function rpcFailure(err: unknown, timeoutMs: number): Error {
  if (err instanceof Error && err.name === "TimeoutError") {
    return new Error(
      `the daemon did not answer within ${Math.round(timeoutMs / 1000)}s — the run may still be finishing; check \`reins logs\``,
    );
  }
  return err instanceof Error ? err : new Error(String(err));
}

/** `reins help <tool>` / `reins <tool> --help`: the usage line and the summary. */
export function usageText(cmd: ToolCommand): string {
  return `${cmd.usage}\n  ${cmd.summary}`;
}

export function helpText(version: string, tools: Record<string, ToolCommand>): string {
  // Floor: the longest management entry, so its summary never runs into the name.
  const width =
    Math.max(...Object.keys(tools).map((n) => n.length), "key set|status|clear".length) + 2;
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
    "Delegate:",
    tool("do"),
    "",
    "Tabs & pages:",
    ...["tabs", "groups", "group", "ungroup", "open", "close", "focus", "nav"].map(tool),
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
    line("policy", "site permissions: show, deny/readonly <pattern> (grants: popup)"),
    line("key set|status|clear", "the TypeSafe key that powers `reins do` (never echoed)"),
    line("audit", "per-action trail: what the agent did, what policy blocked"),
    line("status", "daemon state, port, connected browsers"),
    line("extension", "install the extension without the Chrome Web Store (load unpacked)"),
    line("", "  --reload: re-stage, then reload an unpacked (dev/sideload) build"),
    line("allow <id>", "allow an unpacked/dev extension to connect"),
    line("restart", "restart the background daemon (after an upgrade or `reins allow`)"),
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

/** packageVersion() falls back to "0.0.0" when package.json is unreadable — not a real version. */
const knownVersion = (v: string) => v !== "0.0.0";

/** A live daemon: its port and last /health reply. */
export interface Daemon {
  port: number;
  health: DaemonHealth;
}

/** How long `reins restart` waits for previously connected browsers to come
 *  back (the extension's reconnect backoff caps at 10s). */
export const RESTART_WAIT_MS = 15_000;

export interface RestartDeps {
  /** Stop the live daemon (if any) and spawn a fresh one. */
  restart(): Promise<{ previous?: Daemon; current: Daemon }>;
  /** Resolve once a browser is on `port`; reject when RESTART_WAIT_MS runs out. */
  waitForBrowsers(port: number): Promise<DaemonHealth>;
  /** Fresh /health, for the final report. */
  probe(port: number): Promise<Daemon | undefined>;
}

/**
 * `reins restart`: restart the daemon, then report what came back. Browsers
 * that were connected reconnect on their own, so wait for one when there was
 * one — the next command would otherwise race the extension. `ok` is false
 * when they don't return in time.
 */
export async function runRestart(deps: RestartDeps): Promise<{ text: string; ok: boolean }> {
  const { previous, current } = await deps.restart();
  const hadBrowsers = (previous?.health.browsers.length ?? 0) > 0;
  // Only the wait's timeout is swallowed — the report below says so.
  if (hadBrowsers) await deps.waitForBrowsers(current.port).catch(() => undefined);
  // Re-probe rather than trust the spawn-time snapshot, which predates any reconnect.
  const h = (await deps.probe(current.port))?.health ?? current.health;

  const prev = previous?.health.version;
  const head =
    prev === undefined
      ? `no daemon was running — started v${h.version} on 127.0.0.1:${current.port}`
      : prev === h.version
        ? `daemon restarted on 127.0.0.1:${current.port} (v${h.version})`
        : `daemon restarted on 127.0.0.1:${current.port} (v${prev} → v${h.version})`;

  if (h.browsers.length > 0) {
    const names = [...new Set(h.browsers.map((b) => b.browser))].join(", ");
    return { text: `${head}\nbrowser: ${h.browsers.length} connected (${names})`, ok: true };
  }
  if (hadBrowsers) {
    const secs = Math.round(RESTART_WAIT_MS / 1000);
    return {
      text: `${head}\nbrowser: none reconnected within ${secs}s — check the extension (\`reins status\`)`,
      ok: false,
    };
  }
  return { text: `${head}\nbrowser: none connected (none were before the restart)`, ok: true };
}

/** Human status lines for `reins status`. `cliVersion` adds a hint when the daemon is older. */
export function healthSummary(
  h: DaemonHealth | undefined,
  port: number,
  cliVersion?: string,
): string {
  if (!h) {
    return [
      `daemon : not running (no reins daemon answered on the candidate ports around ${port})`,
      "         it starts on demand — any tool command (e.g. `reins tabs`) spawns it",
    ].join("\n");
  }
  const lines = [`daemon : running on 127.0.0.1:${port} (v${h.version})`];
  if (cliVersion !== undefined && wantsRestart(h.version, cliVersion)) {
    lines.push(
      `         older than the CLI (v${cliVersion}) — \`reins restart\`, or the next tool command restarts it`,
    );
  }
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
        `  ${t.browserId ?? "?"}  tab ${t.tabId}${t.active ? " *" : "  "}${t.groupId !== undefined ? `  g${t.groupId}` : ""}  ${t.title || "(untitled)"} — ${t.url}`,
    )
    .join("\n");
}

/** Group listing for `reins groups`, then one line per browser the daemon
 *  couldn't ask. */
export function groupsText(groups: TabGroup[], skipped: SkippedBrowser[] = []): string {
  const lines =
    groups.length === 0
      ? ["(no groups)"]
      : groups.map(
          (g) =>
            `  ${g.browserId ?? "?"}  group ${g.groupId}  "${g.title}"  ${g.color}  ${g.tabCount} tab${g.tabCount === 1 ? "" : "s"}${g.collapsed ? "  (collapsed)" : ""}  window ${g.windowId}`,
        );
  for (const s of skipped) {
    const why =
      s.reason === "unsupported"
        ? "tab groups not supported"
        : s.reason === "outdated"
          ? "reins extension too old for tab groups (update it)"
          : `failed: ${s.message}`;
    lines.push(`  ${s.browserId}  ${s.browser} — ${why}`);
  }
  return lines.join("\n");
}

export interface DoctorCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface DoctorReport {
  checks: DoctorCheck[];
  ok: boolean;
}

/**
 * Daemon vs CLI version. Older daemon: left over from before an upgrade, so
 * restart it. Newer daemon: this CLI is the stale one (a second install, or
 * an old copy earlier on PATH) — restarting from it would downgrade the daemon.
 */
function versionCheck(daemon: string, cli: string): DoctorCheck {
  if (isOlderVersion(daemon, cli)) {
    return {
      name: "version",
      ok: false,
      detail: `daemon v${daemon}, CLI v${cli} — run \`reins restart\``,
    };
  }
  if (isOlderVersion(cli, daemon)) {
    return {
      name: "version",
      ok: false,
      detail: `daemon v${daemon} is newer than this CLI (v${cli}) — upgrade it (\`npm i -g @karnstack/reins@latest\`) or check \`which -a reins\` for a second install`,
    };
  }
  return { name: "version", ok: true, detail: `daemon and CLI both v${cli}` };
}

/** Diagnostic checks for `reins doctor`. `cliVersion` is compared against the daemon's. */
export function doctorReport(
  cfg: ReinsConfig,
  health: DaemonHealth | undefined,
  cliVersion: string,
): DoctorReport {
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
    ...(health && knownVersion(health.version) && knownVersion(cliVersion)
      ? [versionCheck(health.version, cliVersion)]
      : []),
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
