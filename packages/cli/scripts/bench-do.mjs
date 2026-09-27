// Manual, paid benchmark: `reins do` vs. Claude driving reins step by step.
// Never run in CI. It opens tabs in the user's real browser (foreground, so
// Jev can act on them), costs TypeSafe calls for the `do` arm and Claude API
// spend for the `manual` arm.
//
//   node packages/cli/scripts/bench-do.mjs [--runs 5] [--arm do|manual|both]
//        [--tasks wikipedia,github] [--out bench-do.json] [--claude-budget-usd 2]
//   node packages/cli/scripts/bench-do.mjs --check-only wikipedia --tab <id>
//   node packages/cli/scripts/bench-do.mjs --dry --runs 1   # self-test: fake tabs, `sleep 5` children
//
// Cheap first pass:  --arm do --runs 1
// The full ship-bar run:  --runs 5  (both arms, all tasks)
import { execFileSync, spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { parseArgs } from "node:util";

const TASKS = [
  {
    id: "flights",
    url: "https://www.google.com/travel/flights?hl=en",
    goal: "Find one-way flights from Zurich to London on November 20, 2026, for one adult in economy. Stop when matching flight options are visible.",
    fills: { from: "Zurich", to: "London" },
    // A results page carries the encoded search in `tfs=` and shows prices;
    // the filled-but-unsearched form and "no flights found" have neither.
    // Prices follow the viewer's locale (₹ from India), so any currency sign.
    check:
      "location.href.includes('/travel/flights') && /[?&]tfs=/.test(location.search) && /(CHF|\\p{Sc})\\s?\\d/u.test(document.body.innerText) && /Zurich|ZRH/.test(document.body.innerText) && /London/.test(document.body.innerText) && /Nov 20|20 Nov|November 20/.test(document.body.innerText)",
  },
  {
    id: "wikipedia",
    url: "https://en.wikipedia.org/wiki/Main_Page",
    goal: "Find and open the Wikipedia article about Gödel's incompleteness theorems.",
    fills: { query: "Gödel's incompleteness theorems" },
    // Chrome leaves the apostrophe unencoded in pathname, so compare decoded.
    check: 'decodeURIComponent(location.pathname) === "/wiki/Gödel\'s_incompleteness_theorems"',
  },
  {
    id: "github",
    url: "https://github.com/search?type=repositories",
    goal: "Search GitHub repositories for 'browser automation' written in TypeScript, sorted by most stars.",
    fills: { query: "browser automation" },
    check:
      "/[?&]q=[^&]*browser/i.test(location.search) && /language(%3A|:)TypeScript|[?&]l=TypeScript/i.test(decodeURIComponent(location.href)) && /[?&]s=stars/.test(location.search) && document.querySelectorAll('[data-testid=\"results-list\"] h3').length > 0",
  },
  {
    id: "cookies",
    url: "https://www.bbc.com/weather",
    goal: "Dismiss any cookie or consent banner, then show the weather forecast for Zurich.",
    fills: { place: "Zurich" },
    // A forecast URL (/weather/<geonameId>), the place in the title, and no
    // visible cookie/consent dialog left. From this machine's region BBC shows
    // no consent banner at all (only a survey alertdialog), so the dialog part
    // is a guard, not the proof.
    check:
      "/^\\/weather\\/\\d+/.test(location.pathname) && /Zurich|Zürich/.test(document.title) && ![...document.querySelectorAll('#bbccookies, [id^=sp_message], #onetrust-banner-sdk, [role=dialog], [role=alertdialog]')].some(e => /cookie|consent/i.test(e.innerText || '') && (e.offsetWidth || e.offsetHeight))",
  },
];

const { values: opts } = parseArgs({
  options: {
    runs: { type: "string", default: "5" },
    arm: { type: "string", default: "both" },
    tasks: { type: "string" },
    out: { type: "string", default: "bench-do.json" },
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
      "         [--tasks id1,id2] [--out bench-do.json] [--claude-budget-usd 2]",
      "       node packages/cli/scripts/bench-do.mjs --check-only <taskId> --tab <id>",
      "       node packages/cli/scripts/bench-do.mjs --dry [--runs 1]   (self-test, no browser, no spend)",
      `tasks: ${TASKS.map((t) => t.id).join(", ")}`,
    ].join("\n"),
  );
  process.exit(0);
}

const RUNS = Number(opts.runs);
if (!Number.isInteger(RUNS) || RUNS < 1) die(`--runs must be a positive integer, got ${opts.runs}`);
if (!["do", "manual", "both"].includes(opts.arm)) die("--arm must be do, manual or both");
const ARMS = opts.arm === "both" ? ["do", "manual"] : [opts.arm];
const taskFilter = opts.tasks
  ?.split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const tasks = taskFilter ? TASKS.filter((t) => taskFilter.includes(t.id)) : TASKS;
for (const id of taskFilter ?? []) {
  if (!TASKS.some((t) => t.id === id))
    die(`unknown task ${id}; known: ${TASKS.map((t) => t.id).join(", ")}`);
}

function die(msg) {
  console.error(msg);
  process.exit(1);
}

const sh = (cmd, args) => execFileSync(cmd, args, { encoding: "utf8" }).trim();

const DRY = opts.dry === true;
let dryTab = 0;

/** `reins open` prints `opened tab <id>`; with --json it prints `{ "tabId": <id> }`. */
function openTab(url) {
  if (DRY) return ++dryTab;
  const out = JSON.parse(sh("reins", ["open", url, "--json"]));
  if (typeof out.tabId !== "number")
    throw new Error(`reins open: no tabId in ${JSON.stringify(out)}`);
  return out.tabId;
}

const closeTab = (tab) => (DRY ? "ok (dry)" : sh("reins", ["close", "--tab", String(tab)]));

/** Independent checker: `reins eval --json` prints `{ "value": <result> }`. */
function verify(tab, check) {
  if (DRY) return false;
  try {
    const out = JSON.parse(sh("reins", ["eval", check, "--tab", String(tab), "--json"]));
    return out.value === true;
  } catch (err) {
    console.error(`  verify failed: ${err instanceof Error ? err.message : err}`);
    return false;
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

/**
 * Spawn a child and resolve when it exits, never reject. A timeout sends
 * SIGTERM (then SIGKILL) and marks the result `timedOut`; a user interrupt
 * kills it the same way via `killCurrent`. Only the interrupt stops the
 * benchmark; a timeout is just a failed row.
 */
let current;
function run(cmd, args, timeoutMs) {
  return new Promise((resolve) => {
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
      resolve({
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

function runDo(task, tab) {
  if (DRY) return run("sleep", ["5"], 120_000);
  const args = [
    "do",
    task.goal,
    ...Object.entries(task.fills).flatMap(([k, v]) => ["--fill", `${k}=${v}`]),
    "--tab",
    String(tab),
    "--json",
  ];
  return run("reins", args, 120_000);
}

function manualPrompt(task, tab) {
  const fills = Object.entries(task.fills)
    .map(([k, v]) => `${k}: ${v}`)
    .join("; ");
  return [
    `You are driving the user's browser with the reins CLI, step by step, in tab ${tab}.`,
    `Task: ${task.goal}`,
    `Values to use: ${fills}.`,
    "",
    "Rules:",
    `- Every reins command must pass --tab ${tab}. Do not touch other tabs and do not open, close or focus tabs.`,
    "- One plain reins command per Bash call: no pipes, no &&, no shell wrappers, no other programs.",
    "- Never navigate by URL: reach the result through the page's own UI (search box, buttons, filters).",
    `- The only commands available: ${MANUAL_STEP_COMMANDS.map((c) => `reins ${c}`).join(", ")}. Anything else is denied.`,
    "- Do NOT use `reins do`.",
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

const results = [];
// Ctrl-C: the loop is async, so the handler runs right away. It marks the
// benchmark as stopping and kills the running child; the run's `finally`
// closes the tab (a second Ctrl-C during that close is ignored so the tab
// never leaks), then partial results are written and we exit 130.
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

function safeClose(tab) {
  closing = true;
  try {
    closeTab(tab);
  } catch (err) {
    if (interruptedChild(err)) stopping = true;
    console.error(`  close tab ${tab} failed: ${err instanceof Error ? err.message : err}`);
  } finally {
    closing = false;
  }
}

async function runOne(task, arm, i, tab) {
  await sleep(2_000); // initial load is outside the clock in both arms
  if (stopping) return;
  const out = await (arm === "do" ? runDo(task, tab) : runManual(task, tab));
  // A killed child may still have left the page in the wanted state; it does
  // not count. A verified row must have finished on its own, inside the clock.
  const ok = stopping || out.timedOut ? false : verify(tab, task.check);
  const row = {
    task: task.id,
    arm,
    run: i + 1,
    ms: out.ms,
    verified: ok,
    exit: out.status,
    timedOut: out.timedOut,
    interrupted: stopping,
  };
  const body = parseJson(out.stdout);
  if (arm === "do") {
    row.status = body?.status ?? (out.error ? "spawn_error" : "unparsed");
    row.reason = body?.reason;
    row.jevCalls = body?.jevCalls;
    row.elapsedMs = body?.elapsedMs;
    row.step = body?.step;
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
  const extra =
    arm === "do"
      ? `${row.status} step=${row.step ?? "?"} jev=${row.jevCalls ?? "?"}`
      : `turns=${row.turns ?? "?"} $${row.costUsd?.toFixed?.(3) ?? "?"}`;
  const mark = out.timedOut ? "timeout" : stopping ? "interrupted" : ok ? "✓" : "✗";
  console.log(`${task.id} ${arm} #${i + 1}: ${out.ms} ms ${mark} (${extra})`);
}

async function runAll() {
  console.log(
    `bench-do${DRY ? " (dry)" : ""}: ${tasks.length} task(s) × ${ARMS.join("+")} × ${RUNS} run(s)`,
  );
  for (const task of tasks) {
    for (let i = 0; i < RUNS; i++) {
      for (const arm of ARMS) {
        if (stopping) return;
        const tab = openTab(task.url);
        try {
          await runOne(task, arm, i, tab);
        } finally {
          safeClose(tab);
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
}

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
    doVerified: `${ok("do").length}/${arm("do").length}`,
    manualVerified: `${ok("manual").length}/${arm("manual").length}`,
    doMedianMs: doMed,
    manualMedianMs: manMed,
    speedup: doMed && manMed ? Number((manMed / doMed).toFixed(2)) : undefined,
  };
});

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
  dry: DRY,
  partial: stopping || crashed !== undefined,
  interrupted: stopping,
  crashed,
};
writeFileSync(opts.out, JSON.stringify({ env, results, rows }, null, 2));

const fmt = (v) => (v === undefined ? "—" : String(v));
console.log("");
console.log(
  "| task | do verified | manual verified | do median (ms) | manual median (ms) | speed-up |",
);
console.log("|---|---|---|---|---|---|");
for (const r of rows) {
  console.log(
    `| ${r.task} | ${r.doVerified} | ${r.manualVerified} | ${fmt(r.doMedianMs)} | ${fmt(r.manualMedianMs)} | ${r.speedup ? `${r.speedup}×` : "—"} |`,
  );
}
console.log(
  `\nwrote ${opts.out}${stopping ? " (partial: interrupted)" : crashed ? " (partial: aborted)" : ""}`,
);
if (stopping) process.exit(130);
if (crashed) process.exit(1);
