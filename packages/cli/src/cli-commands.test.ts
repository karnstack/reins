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
  RESTART_WAIT_MS,
  runRestart,
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
    for (const cmd of [
      "browsers",
      "status",
      "allow",
      "restart",
      "kill",
      "doctor",
      "logs",
      "daemon",
      "key",
    ]) {
      expect(text).toContain(cmd);
    }
    for (const gone of ["reins up", "install claude", "--stdio"]) {
      expect(text, gone).not.toContain(gone);
    }
  });

  it("help mentions extension --reload", () => {
    expect(helpText("1.2.3", TOOL_COMMANDS)).toMatch(/--reload: re-stage, then reload an unpacked/);
  });

  it("help lists the audit command", () => {
    expect(helpText("1.2.3", TOOL_COMMANDS)).toContain("audit");
  });

  it("describes restart as the thing to run after an upgrade or `reins allow`", () => {
    expect(helpText("1.2.3", TOOL_COMMANDS)).toContain(
      "restart the background daemon (after an upgrade or `reins allow`)",
    );
  });
});

describe("runRestart", () => {
  const NONE = { ...HEALTH, browsers: [] };
  const daemon = (port: number, health = HEALTH) => ({ port, health });

  /** Deps whose wait resolves (or times out) and whose probe answers `after`. */
  function deps(opts: {
    previous?: { port: number; health: typeof HEALTH };
    after: typeof HEALTH;
    waitTimesOut?: boolean;
  }) {
    const calls = { waited: 0, probed: 0 };
    return {
      calls,
      restart: async () => ({
        ...(opts.previous ? { previous: opts.previous } : {}),
        current: daemon(8765, NONE),
      }),
      waitForBrowsers: async () => {
        calls.waited++;
        if (opts.waitTimesOut) throw new Error("no browser connected");
        return opts.after;
      },
      probe: async (port: number) => {
        calls.probed++;
        return daemon(port, opts.after);
      },
    };
  }

  it("reports the browsers that came back, with the version change", async () => {
    const d = deps({ previous: daemon(8765, { ...HEALTH, version: "0.0.9" }), after: HEALTH });
    const { text, ok } = await runRestart(d);
    expect(ok).toBe(true);
    expect(text).toBe(
      "daemon restarted on 127.0.0.1:8765 (v0.0.9 → v0.1.0)\nbrowser: 1 connected (Chrome)",
    );
    expect(d.calls.waited).toBe(1);
  });

  it("drops the arrow when the version is unchanged", async () => {
    const { text } = await runRestart(deps({ previous: daemon(8765), after: HEALTH }));
    expect(text).toContain("(v0.1.0)\n");
  });

  it("fails plainly when browsers were connected before but none came back", async () => {
    const d = deps({ previous: daemon(8765), after: NONE, waitTimesOut: true });
    const { text, ok } = await runRestart(d);
    expect(ok).toBe(false);
    expect(text).toContain(
      `browser: none reconnected within ${RESTART_WAIT_MS / 1000}s — check the extension (\`reins status\`)`,
    );
    expect(text).not.toContain("~10s");
  });

  it("does not wait, and does not imply a reconnect, when nothing was connected before", async () => {
    const d = deps({ previous: daemon(8765, NONE), after: NONE });
    const { text, ok } = await runRestart(d);
    expect(ok).toBe(true);
    expect(text).toContain("browser: none connected (none were before the restart)");
    expect(d.calls.waited).toBe(0);
  });

  it("says when no daemon was running at all", async () => {
    const { text, ok } = await runRestart(deps({ after: NONE }));
    expect(ok).toBe(true);
    expect(text).toContain("no daemon was running — started v0.1.0 on 127.0.0.1:8765");
    expect(text).toContain("none were before the restart");
  });

  it("reports fresh health rather than the spawn-time snapshot", async () => {
    // Spawn snapshot has no browsers; the re-probe after the wait does.
    const d = deps({ previous: daemon(8765), after: HEALTH });
    const { text } = await runRestart(d);
    expect(d.calls.probed).toBe(1);
    expect(text).toContain("browser: 1 connected (Chrome)");
  });

  it("lets a restart failure through untouched", async () => {
    const d = {
      ...deps({ after: NONE }),
      restart: async () => {
        throw new Error("did not stop");
      },
    };
    await expect(runRestart(d)).rejects.toThrow("did not stop");
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

  it("hints at `reins restart` when the daemon is older than the CLI", () => {
    const s = healthSummary(HEALTH, 8765, "0.2.0");
    expect(s).toContain("older than the CLI (v0.2.0) — `reins restart`");
    expect(s.split("\n").filter((l) => l.includes("older than")).length).toBe(1);
  });

  it("stays quiet when versions match, the daemon is newer, or either is unknown", () => {
    expect(healthSummary(HEALTH, 8765, "0.1.0")).not.toContain("older than");
    expect(healthSummary(HEALTH, 8765, "0.0.9")).not.toContain("older than");
    expect(healthSummary(HEALTH, 8765, "0.0.0")).not.toContain("older than");
    expect(healthSummary({ ...HEALTH, version: "0.0.0" }, 8765, "0.2.0")).not.toContain(
      "older than",
    );
    expect(healthSummary(HEALTH, 8765)).not.toContain("older than");
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
      {
        browserId: "b2",
        browser: "Chromium",
        reason: "unsupported" as const,
        message: "Chromium (b2) ...",
      },
      { browserId: "b3", browser: "Arc", reason: "outdated" as const, message: "old" },
      { browserId: "b4", browser: "Brave", reason: "error" as const, message: "timed out" },
    ];
    expect(groupsText([g], skipped)).toBe(
      [
        '  b1  group 7  "reins"  blue  1 tab  window 1',
        "  b2  Chromium — tab groups not supported",
        "  b3  Arc — reins extension too old for tab groups (update it)",
        "  b4  Brave — failed: timed out",
      ].join("\n"),
    );
    expect(groupsText([], skipped.slice(0, 1))).toBe(
      "(no groups)\n  b2  Chromium — tab groups not supported",
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
  const check = (r: ReturnType<typeof doctorReport>, name: string) =>
    r.checks.find((c) => c.name === name);

  it("passes all checks with a healthy daemon and a browser", () => {
    const report = doctorReport(cfg(), HEALTH, "0.1.0");
    expect(report.ok).toBe(true);
    expect(check(report, "daemon")?.ok).toBe(true);
    expect(check(report, "browser")?.ok).toBe(true);
    expect(check(report, "version")).toEqual({
      name: "version",
      ok: true,
      detail: "daemon and CLI both v0.1.0",
    });
  });

  it("fails the daemon and browser checks when nothing is running", () => {
    const report = doctorReport(cfg(), undefined, "0.1.0");
    expect(report.ok).toBe(false);
    expect(check(report, "daemon")?.ok).toBe(false);
    // Nothing to compare against — no version line.
    expect(check(report, "version")).toBeUndefined();
  });

  it("fails the version check, with the fix, when the daemon predates the CLI", () => {
    const report = doctorReport(cfg(), { ...HEALTH, version: "0.4.0" }, "0.5.0");
    expect(report.ok).toBe(false);
    expect(check(report, "version")).toEqual({
      name: "version",
      ok: false,
      detail: "daemon v0.4.0, CLI v0.5.0 — run `reins restart`",
    });
  });

  it("points at the CLI, not a restart, when the daemon is newer", () => {
    // A restart from this older CLI would downgrade the daemon.
    const report = doctorReport(cfg(), { ...HEALTH, version: "0.6.0" }, "0.5.0");
    expect(report.ok).toBe(false);
    const detail = check(report, "version")?.detail ?? "";
    expect(detail).toBe(
      "daemon v0.6.0 is newer than this CLI (v0.5.0) — upgrade it (`npm i -g @karnstack/reins@latest`) or check `which -a reins` for a second install",
    );
    expect(detail).not.toContain("reins restart");
  });

  it("passes when only a pre-release tag differs", () => {
    const report = doctorReport(cfg(), { ...HEALTH, version: "0.5.0-next.1" }, "0.5.0");
    expect(check(report, "version")?.ok).toBe(true);
  });

  it("skips the version check when either side is the unknown 0.0.0", () => {
    expect(
      check(doctorReport(cfg(), { ...HEALTH, version: "0.0.0" }, "0.5.0"), "version"),
    ).toBeUndefined();
    expect(check(doctorReport(cfg(), HEALTH, "0.0.0"), "version")).toBeUndefined();
    expect(doctorReport(cfg(), HEALTH, "0.0.0").ok).toBe(true);
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
