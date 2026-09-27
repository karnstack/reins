// Manual, paid benchmark: `reins do` vs. Claude driving reins step by step.
// Never run in CI. It opens tabs in the user's real browser (foreground, so
// Jev can act on them), costs TypeSafe calls for the `do` arm and Claude API
// spend for the `manual` arm.
//
//   node packages/cli/scripts/bench-do.mjs [--runs 5] [--arm do|manual|both]
//        [--set dev|holdout2|all] [--tier fixture|live|all] [--tasks a,b]
//        [--out-dir bench-out] [--out <summary.json>] [--claude-budget-usd 2]
//        [--trace <jev-trace.jsonl>]
//   node packages/cli/scripts/bench-do.mjs --check-only wikipedia --tab <id>
//   node packages/cli/scripts/bench-do.mjs --dry --runs 1   # self-test: fake tabs, `sleep 5` children
//
// Tasks live in ./bench/tasks.mjs (fixture tier served from ./bench/fixtures by
// this script on 127.0.0.1:<random port>; live tier on the public web).
//
// Every run leaves a trace dir  bench-out/<timestamp>/<task>-<arm>-<n>/  with
//   result.json      the `reins do --json` output (steps included) or the manual
//                    arm's claude JSON, plus the row this script derived
//   screenshot.png   the tab the run ended on
//   jev-trace.jsonl  the daemon's Jev trace lines for this run's time window,
//                    when a trace file is known (see below)
//
// Jev trace (opt-in diagnostics): the daemon writes one JSON line per Jev call
// when started with REINS_JEV_TRACE=<file>. This script cannot set the
// daemon's environment; the coordinator starts the daemon with it —
//     REINS_JEV_TRACE=/tmp/jev-trace.jsonl reins restart
// — and passes the same path here as --trace (or REINS_JEV_TRACE in this
// script's env). The runner copies the lines whose `t` falls inside each run
// into that run's trace dir.
//
// Cheap first pass:  --arm do --runs 1
// The full ship-bar run:  --runs 5  (both arms, all tasks)
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { TASK_IDS, TASKS } from "./bench/tasks.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

const { values: opts } = parseArgs({
  options: {
    runs: { type: "string", default: "5" },
    arm: { type: "string", default: "both" },
    set: { type: "string", default: "all" },
    tier: { type: "string", default: "all" },
    tasks: { type: "string" },
    out: { type: "string" },
    "out-dir": { type: "string", default: "bench-out" },
    trace: { type: "string" },
    "check-only": { type: "string" },
    tab: { type: "string" },
    "claude-budget-usd": { type: "string", default: "2" },
    dry: { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  },
});

if (opts.help) {
  console.log(
    [
      "usage: node packages/cli/scripts/bench-do.mjs [--runs 5] [--arm do|manual|both]",
      "         [--set dev|holdout2|all] [--tier fixture|live|all] [--tasks id1,id2]",
      "         [--out-dir bench-out] [--out <summary.json>] [--claude-budget-usd 2] [--trace <file>]",
      "       node packages/cli/scripts/bench-do.mjs --check-only <taskId> --tab <id>",
      "       node packages/cli/scripts/bench-do.mjs --dry [--runs 1]   (self-test, no browser, no spend)",
      `tasks: ${TASK_IDS.join(", ")}`,
    ].join("\n"),
  );
  process.exit(0);
}

function die(msg) {
  console.error(msg);
  process.exit(1);
}

const RUNS = Number(opts.runs);
if (!Number.isInteger(RUNS) || RUNS < 1) die(`--runs must be a positive integer, got ${opts.runs}`);
if (!["do", "manual", "both"].includes(opts.arm)) die("--arm must be do, manual or both");
if (!["dev", "holdout2", "all"].includes(opts.set)) die("--set must be dev, holdout2 or all");
if (!["fixture", "live", "all"].includes(opts.tier)) die("--tier must be fixture, live or all");
const ARMS = opts.arm === "both" ? ["do", "manual"] : [opts.arm];
const taskFilter = opts.tasks
  ?.split(",")
  .map((s) => s.trim())
  .filter(Boolean);
for (const id of taskFilter ?? []) {
  if (!TASK_IDS.includes(id)) die(`unknown task ${id}; known: ${TASK_IDS.join(", ")}`);
}
const tasks = TASKS.filter(
  (t) =>
    (opts.set === "all" || t.set === opts.set) &&
    (opts.tier === "all" || t.tier === opts.tier) &&
    (!taskFilter || taskFilter.includes(t.id)),
);
if (tasks.length === 0) die("no tasks match the filters");

const sh = (cmd, args) => execFileSync(cmd, args, { encoding: "utf8" }).trim();

const DRY = opts.dry === true;
let dryTab = 0;

/** `reins open --json` prints `{ "tabId": <id> }`. When the CLI gives up
 *  waiting (a busy daemon), the browser may still have opened the tab: find it
 *  by URL among the tabs that were not there before, so it never leaks. */
function openTab(url) {
  if (DRY) return ++dryTab;
  const before = listTabIds();
  try {
    const out = JSON.parse(sh("reins", ["open", url, "--json"]));
    if (typeof out.tabId !== "number")
      throw new Error(`reins open: no tabId in ${JSON.stringify(out)}`);
    return out.tabId;
  } catch (err) {
    if (interruptedChild(err)) throw err;
    // The page may not have loaded yet, so its url can still be blank.
    const stray = listTabs().find(
      (t) => !before.has(t.tabId) && (t.url === url || !t.url || t.url === "about:blank"),
    );
    if (stray) {
      console.error(`  reins open failed but the tab exists (${stray.tabId}); using it`);
      return stray.tabId;
    }
    throw err;
  }
}

function listTabs() {
  if (DRY) return [];
  try {
    return JSON.parse(sh("reins", ["tabs", "--json"])).tabs ?? [];
  } catch {
    return [];
  }
}

const closeTab = (tab) => (DRY ? "ok (dry)" : sh("reins", ["close", "--tab", String(tab)]));

/** Independent checker: `reins eval --json --await` prints `{ "value": <result> }`. */
function verify(tab, check) {
  if (DRY) return false;
  try {
    const out = JSON.parse(sh("reins", ["eval", check, "--tab", String(tab), "--await", "--json"]));
    return out.value === true;
  } catch (err) {
    console.error(`  verify failed: ${err instanceof Error ? err.message : err}`);
    return false;
  }
}

function screenshot(tab, file) {
  if (DRY) return;
  try {
    sh("reins", ["screenshot", "--tab", String(tab), "--out", file, "--json"]);
  } catch (err) {
    console.error(`  screenshot failed: ${err instanceof Error ? err.message : err}`);
  }
}

if (opts["check-only"]) {
  const task = TASKS.find((t) => t.id === opts["check-only"]);
  if (!task) die(`unknown task ${opts["check-only"]}`);
  const tab = Number(opts.tab);
  if (!opts.tab || !Number.isInteger(tab) || tab <= 0)
    die(`--check-only needs --tab <integer id>, got ${opts.tab ?? "nothing"}`);
  const ok = verify(tab, task.check);
  console.log(`${task.id} on tab ${opts.tab}: ${ok ? "verified" : "not verified"}`);
  process.exit(ok ? 0 : 1);
}

// ── fixture server ──────────────────────────────────────────────────────────
/** ./bench/fixture-server.mjs in a child process (see its header for why),
 *  resolving with its port once it prints it. */
function startFixtureServer() {
  return new Promise((resolveServer, reject) => {
    const child = spawn(process.execPath, [join(HERE, "bench", "fixture-server.mjs")], {
      stdio: ["ignore", "pipe", "inherit"],
    });
    let buf = "";
    let ready = false;
    child.stdout.setEncoding("utf8").on("data", (d) => {
      buf += d;
      const line = buf.split("\n")[0];
      if (!ready && buf.includes("\n")) {
        ready = true;
        try {
          resolveServer({
            port: JSON.parse(line).port,
            close: () =>
              new Promise((r) => {
                child.once("exit", () => r());
                child.kill("SIGTERM");
              }),
          });
        } catch (err) {
          reject(err);
        }
      }
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (!ready) reject(new Error(`fixture server exited early (code ${code})`));
    });
  });
}

const needsFixtures = tasks.some((t) => t.tier === "fixture");
const fixtureServer = needsFixtures && !DRY ? await startFixtureServer() : undefined;
const fixturePort = fixtureServer?.port ?? 0;

/** `fixture:<file>` → the local server's URL; anything else is returned as is. */
function taskUrl(task) {
  return task.url.startsWith("fixture:")
    ? `http://127.0.0.1:${fixturePort}/${task.url.slice("fixture:".length)}`
    : task.url;
}

// ── output dirs ─────────────────────────────────────────────────────────────
const STAMP = new Date().toISOString().replace(/[:.]/g, "-");
const OUT_ROOT = resolve(opts["out-dir"]);
const RUN_DIR = join(OUT_ROOT, STAMP);
const SUMMARY_FILE = opts.out ? resolve(opts.out) : join(RUN_DIR, "bench-do.json");
mkdirSync(RUN_DIR, { recursive: true });

const TRACE_FILE = opts.trace ?? process.env.REINS_JEV_TRACE;

/** Lines of the daemon's Jev trace whose `t` lies in [from, to]. */
function traceSegment(from, to) {
  if (!TRACE_FILE || !existsSync(TRACE_FILE)) return undefined;
  const lines = readFileSync(TRACE_FILE, "utf8")
    .split("\n")
    .filter(Boolean)
    .filter((l) => {
      try {
        const t = JSON.parse(l).t;
        return typeof t === "string" && t >= from && t <= to;
      } catch {
        return false;
      }
    });
  return lines;
}

// ── children ────────────────────────────────────────────────────────────────
/**
 * Spawn a child and resolve when it exits, never reject. A timeout sends
 * SIGTERM (then SIGKILL) and marks the result `timedOut`; a user interrupt
 * kills it the same way via `killCurrent`. Only the interrupt stops the
 * benchmark; a timeout is just a failed row.
 */
let current;
function run(cmd, args, timeoutMs) {
  return new Promise((resolveRun) => {
    const t0 = performance.now();
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let spawnError;
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    current = child;
    child.stdout.setEncoding("utf8").on("data", (d) => {
      stdout += d;
    });
    child.stderr.setEncoding("utf8").on("data", (d) => {
      stderr += d;
    });
    const timer = setTimeout(() => {
      timedOut = true;
      kill(child);
    }, timeoutMs);
    child.on("error", (err) => {
      spawnError = err;
    });
    child.on("close", (status, signal) => {
      clearTimeout(timer);
      if (current === child) current = undefined;
      resolveRun({
        ms: Math.round(performance.now() - t0),
        status,
        signal,
        stdout,
        stderr,
        timedOut,
        error: spawnError,
      });
    });
  });
}

function kill(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  const hard = setTimeout(() => child.kill("SIGKILL"), 5_000);
  child.once("close", () => clearTimeout(hard));
}

const doTimeoutSec = (task) => task.timeoutSec ?? 60;

function runDo(task, tab) {
  if (DRY) return run("sleep", ["5"], 120_000);
  const args = [
    "do",
    task.goal,
    ...Object.entries(task.fills).flatMap(([k, v]) => ["--fill", `${k}=${v}`]),
    "--timeout",
    String(doTimeoutSec(task)),
    "--tab",
    String(tab),
    "--json",
  ];
  // The loop stops itself at --timeout; the act in flight can take one more
  // bridge call (30 s), and the CLI waits 40 s past the timeout. Kill after.
  return run("reins", args, (doTimeoutSec(task) + 60) * 1000);
}

function manualPrompt(task, tab) {
  const fills = Object.entries(task.fills)
    .map(([k, v]) => `${k}: ${v}`)
    .join("; ");
  return [
    `You are driving the user's browser with the reins CLI, step by step, in tab ${tab}.`,
    `Task: ${task.goal}`,
    fills ? `Values to use: ${fills}.` : "No values are supplied; the task names everything.",
    "",
    "Rules:",
    `- Every reins command must pass --tab ${tab}. Do not touch other tabs and do not open, close or focus tabs.`,
    "- One plain reins command per Bash call: no pipes, no &&, no shell wrappers, no other programs.",
    "- Never navigate by URL: reach the result through the page's own UI (search box, buttons, filters).",
    `- The only commands available: ${MANUAL_STEP_COMMANDS.map((c) => `reins ${c}`).join(", ")}. Anything else is denied.`,
    "- Do NOT use `reins do`.",
    "- If the next click would delete, send, pay or otherwise do something irreversible, stop and say so instead of clicking.",
    "- Stop as soon as the task's end state is visible on the page. Reply with one line saying what is on screen.",
  ].join("\n");
}

/** The step commands the manual arm may run (names from `reins help`). */
const MANUAL_STEP_COMMANDS = [
  "snapshot",
  "click",
  "type",
  "fill",
  "select",
  "press",
  "hover",
  "scroll",
  "wait",
  "text",
  "screenshot",
];

/**
 * Least-permissive combination on claude 2.1.283:
 *   --restricted   ignores user/project settings (the user's allow all Bash) and strips code tools
 *   --tools Bash   adds Bash back, and nothing else
 *   --allowedTools  an explicit allowlist of the step commands; everything else
 *                   (reins do/open/close/focus/nav/eval/cdp/tabs/policy/…, any other program) prompts…
 *   --permission-prompts none  …and a prompt in -p mode is a denial, not a hang
 *   --disallowedTools "Bash(reins do:*)"  belt and braces: the deny wins even if an allow matched
 *   --disable-slash-commands  keeps the user's reins skill (which documents `reins do`) out
 */
function runManual(task, tab) {
  if (DRY) return run("sleep", ["5"], 600_000);
  const args = [
    "-p",
    manualPrompt(task, tab),
    "--restricted",
    "--tools",
    "Bash",
    "--allowedTools",
    ...MANUAL_STEP_COMMANDS.map((c) => `Bash(reins ${c}:*)`),
    "--disallowedTools",
    "Bash(reins do:*)",
    "--permission-prompts",
    "none",
    "--disable-slash-commands",
    "--no-session-persistence",
    "--output-format",
    "json",
    "--max-budget-usd",
    String(opts["claude-budget-usd"]),
  ];
  return run("claude", args, 600_000);
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

// ── the loop ────────────────────────────────────────────────────────────────
const results = [];
// Ctrl-C: the loop is async, so the handler runs right away. It marks the
// benchmark as stopping and kills the running child; the run's `finally`
// closes the tabs (a second Ctrl-C during that close is ignored so no tab
// leaks), then partial results are written and we exit 130.
let stopping = false;
let closing = false;
process.on("SIGINT", () => {
  if (closing) return;
  if (stopping) process.exit(130);
  stopping = true;
  console.error(
    "\nbench-do: interrupted — stopping after this run's cleanup, writing partial results",
  );
  if (current) kill(current);
});

/** Ctrl-C reaches every process in the terminal's group, so a `reins open` /
 *  `close` / `eval` in flight dies of SIGINT and its execFileSync throws —
 *  before the SIGINT handler above gets its turn. That is the interrupt. */
function interruptedChild(err) {
  return err?.signal === "SIGINT";
}

function safeCloseAll(tabs) {
  closing = true;
  try {
    for (const tab of tabs) {
      try {
        closeTab(tab);
      } catch (err) {
        if (interruptedChild(err)) stopping = true;
        console.error(`  close tab ${tab} failed: ${err instanceof Error ? err.message : err}`);
      }
    }
  } finally {
    closing = false;
  }
}

/** Manual arm: the tab the run ended on isn't reported; ask the browser which
 *  tabs exist now versus before, so a target=_blank link is still checked and closed. */
function listTabIds() {
  return new Set(listTabs().map((t) => t.tabId));
}

async function runOne(task, arm, i, tab, opened) {
  const dir = join(RUN_DIR, `${task.id}-${arm}-${i + 1}`);
  mkdirSync(dir, { recursive: true });
  await sleep(2_000); // initial load is outside the clock in both arms
  if (stopping) return;
  const before = arm === "manual" ? listTabIds() : undefined;
  const startedAt = new Date().toISOString();
  const out = await (arm === "do" ? runDo(task, tab) : runManual(task, tab));
  const endedAt = new Date().toISOString();
  const body = parseJson(out.stdout);

  // The tab the run ended on: `reins do` reports it; a manual run that
  // opened a new tab is found by diffing the tab list.
  let finalTab = tab;
  if (arm === "do" && typeof body?.tabId === "number") finalTab = body.tabId;
  const followed = new Set();
  for (const s of body?.steps ?? [])
    if (typeof s.openedTabId === "number") followed.add(s.openedTabId);
  if (before) {
    for (const id of listTabIds()) if (!before.has(id) && id !== tab) followed.add(id);
    if (followed.size > 0) finalTab = [...followed].at(-1);
  }
  for (const id of followed) opened.add(id);
  opened.add(finalTab);

  // A killed child may still have left the page in the wanted state; it does
  // not count. A verified row must have finished on its own, inside the clock.
  const finished = !stopping && !out.timedOut;
  const checkOk = finished ? verify(finalTab, task.check) : false;
  const statusOk = task.expect?.status ? body?.status === task.expect.status : true;
  const ok = finished && checkOk && statusOk;
  screenshot(finalTab, join(dir, "screenshot.png"));

  const row = {
    task: task.id,
    tier: task.tier,
    set: task.set,
    arm,
    run: i + 1,
    ms: out.ms,
    verified: ok,
    checkOk,
    ...(task.expect ? { expected: task.expect, statusOk } : {}),
    exit: out.status,
    timedOut: out.timedOut,
    interrupted: stopping,
    tab,
    finalTab,
    openedTabs: [...followed],
    dir,
  };
  if (arm === "do") {
    row.status = body?.status ?? (out.error ? "spawn_error" : "unparsed");
    row.reason = body?.reason;
    row.jevCalls = body?.jevCalls;
    row.inputTokens = body?.inputTokens;
    row.elapsedMs = body?.elapsedMs;
    row.step = body?.step;
    row.url = body?.url;
  } else {
    row.turns = body?.num_turns;
    row.costUsd = body?.total_cost_usd;
    row.subtype = body?.subtype;
    row.reply = typeof body?.result === "string" ? body.result.slice(0, 200) : undefined;
  }
  if (out.error) row.error = out.error.message;
  else if (stopping && !body) row.error = "interrupted";
  else if (out.status !== 0 && !body) row.error = out.stderr.trim().slice(0, 300);
  results.push(row);

  const trace = arm === "do" ? traceSegment(startedAt, endedAt) : undefined;
  if (trace) {
    writeFileSync(join(dir, "jev-trace.jsonl"), trace.length ? `${trace.join("\n")}\n` : "");
    row.traceLines = trace.length;
  }
  writeFileSync(
    join(dir, "result.json"),
    JSON.stringify(
      {
        task: { ...task, url: taskUrl(task) },
        arm,
        startedAt,
        endedAt,
        row,
        output: body ?? null,
        stderr: out.stderr.trim().slice(0, 2000) || undefined,
      },
      null,
      2,
    ),
  );

  const extra =
    arm === "do"
      ? `${row.status} step=${row.step ?? "?"} jev=${row.jevCalls ?? "?"}${row.reason ? ` — ${row.reason}` : ""}`
      : `turns=${row.turns ?? "?"} $${row.costUsd?.toFixed?.(3) ?? "?"}`;
  const mark = out.timedOut ? "timeout" : stopping ? "interrupted" : ok ? "✓" : "✗";
  console.log(`${task.id} ${arm} #${i + 1}: ${out.ms} ms ${mark} (${extra})`);
}

async function runAll() {
  console.log(
    `bench-do${DRY ? " (dry)" : ""}: ${tasks.length} task(s) × ${ARMS.join("+")} × ${RUNS} run(s) → ${RUN_DIR}${
      fixtureServer ? ` (fixtures on 127.0.0.1:${fixturePort})` : ""
    }`,
  );
  for (const task of tasks) {
    for (let i = 0; i < RUNS; i++) {
      for (const arm of ARMS) {
        if (stopping) return;
        const tab = openTab(taskUrl(task));
        const opened = new Set([tab]);
        try {
          await runOne(task, arm, i, tab, opened);
        } finally {
          safeCloseAll(opened);
        }
      }
    }
  }
}

let crashed;
try {
  await runAll();
} catch (err) {
  if (interruptedChild(err)) {
    // Ctrl-C during `reins open`: nothing to clean up, just stop.
    stopping = true;
    console.error("\nbench-do: interrupted — writing partial results");
  } else {
    crashed = err instanceof Error ? err.message : String(err);
    console.error(`bench-do: aborted — ${crashed}`);
  }
} finally {
  await fixtureServer?.close();
}

// ── summary ─────────────────────────────────────────────────────────────────
/** Lower-middle median: for an even count the smaller of the two middle values. */
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor((s.length - 1) / 2)] : undefined;
};
const rows = tasks.map((t) => {
  const arm = (a) => results.filter((r) => r.task === t.id && r.arm === a);
  const ok = (a) => arm(a).filter((r) => r.verified);
  const doMed = median(ok("do").map((r) => r.ms));
  const manMed = median(ok("manual").map((r) => r.ms));
  return {
    task: t.id,
    tier: t.tier,
    set: t.set,
    doVerified: `${ok("do").length}/${arm("do").length}`,
    manualVerified: `${ok("manual").length}/${arm("manual").length}`,
    doMedianMs: doMed,
    manualMedianMs: manMed,
    speedup: doMed && manMed ? Number((manMed / doMed).toFixed(2)) : undefined,
    doStatuses: arm("do").map((r) => r.status),
  };
});
const setRows = ["dev", "holdout2"]
  .flatMap((set) => ["fixture", "live", "all"].map((tier) => ({ set, tier })))
  .map(({ set, tier }) => {
    const pick = (a) =>
      results.filter((r) => r.set === set && (tier === "all" || r.tier === tier) && r.arm === a);
    const count = (a) => `${pick(a).filter((r) => r.verified).length}/${pick(a).length}`;
    return { set, tier, doVerified: count("do"), manualVerified: count("manual") };
  })
  .filter((r) => r.doVerified !== "0/0" || r.manualVerified !== "0/0");

function safeVersion(cmd, args) {
  try {
    return sh(cmd, args);
  } catch {
    return undefined;
  }
}
const env = {
  at: new Date().toISOString(),
  node: process.version,
  reins: DRY ? undefined : safeVersion("reins", ["--version"]),
  claude: !DRY && ARMS.includes("manual") ? safeVersion("claude", ["--version"]) : undefined,
  runs: RUNS,
  arms: ARMS,
  set: opts.set,
  tier: opts.tier,
  dry: DRY,
  traceFile: TRACE_FILE,
  runDir: RUN_DIR,
  partial: stopping || crashed !== undefined,
  interrupted: stopping,
  crashed,
};
mkdirSync(dirname(SUMMARY_FILE), { recursive: true });
writeFileSync(SUMMARY_FILE, JSON.stringify({ env, results, rows, setRows }, null, 2));

const fmt = (v) => (v === undefined ? "—" : String(v));
console.log("");
console.log(
  "| task | tier | set | do verified | manual verified | do median (ms) | manual median (ms) | speed-up | do statuses |",
);
console.log("|---|---|---|---|---|---|---|---|---|");
for (const r of rows) {
  console.log(
    `| ${r.task} | ${r.tier} | ${r.set} | ${r.doVerified} | ${r.manualVerified} | ${fmt(r.doMedianMs)} | ${fmt(r.manualMedianMs)} | ${r.speedup ? `${r.speedup}×` : "—"} | ${r.doStatuses.join(", ") || "—"} |`,
  );
}
console.log("");
console.log("| set | tier | do verified | manual verified |");
console.log("|---|---|---|---|");
for (const r of setRows) {
  console.log(`| ${r.set} | ${r.tier} | ${r.doVerified} | ${r.manualVerified} |`);
}
console.log(
  `\nwrote ${SUMMARY_FILE}${stopping ? " (partial: interrupted)" : crashed ? " (partial: aborted)" : ""}`,
);
if (stopping) process.exit(130);
if (crashed) process.exit(1);
