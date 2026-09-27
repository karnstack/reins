// Manual, paid benchmark: `reins do` vs. Claude driving reins step by step.
// Never run in CI. It opens tabs in the user's real browser (foreground, so
// Jev can act on them), costs TypeSafe calls for the `do` arm and Claude API
// spend for the `manual` arm.
//
//   node packages/cli/scripts/bench-do.mjs [--runs 5] [--arm do|manual|both]
//        [--tasks wikipedia,github] [--out bench-do.json] [--claude-budget-usd 2]
//   node packages/cli/scripts/bench-do.mjs --check-only wikipedia --tab <id>
//
// Cheap first pass:  --arm do --runs 1
// The full ship-bar run:  --runs 5  (both arms, all tasks)
import { execFileSync, spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";

const TASKS = [
  {
    id: "flights",
    url: "https://www.google.com/travel/flights?hl=en",
    goal: "Find one-way flights from Zurich to London on September 20, 2026, for one adult in economy. Stop when matching flight options are visible.",
    fills: { from: "Zurich", to: "London" },
    // A results page carries the encoded search in `tfs=` and shows prices;
    // the filled-but-unsearched form and "no flights found" have neither.
    check:
      "location.href.includes('/travel/flights') && /[?&]tfs=/.test(location.search) && /(CHF|£|€|\\$)\\s?\\d/.test(document.body.innerText) && /Zurich|ZRH/.test(document.body.innerText) && /London/.test(document.body.innerText) && /Sep 20|20 Sep|September 20/.test(document.body.innerText)",
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
    help: { type: "boolean", default: false },
  },
});

if (opts.help) {
  console.log(
    [
      "usage: node packages/cli/scripts/bench-do.mjs [--runs 5] [--arm do|manual|both]",
      "         [--tasks id1,id2] [--out bench-do.json] [--claude-budget-usd 2]",
      "       node packages/cli/scripts/bench-do.mjs --check-only <taskId> --tab <id>",
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

/** `reins open` prints `opened tab <id>`; with --json it prints `{ "tabId": <id> }`. */
function openTab(url) {
  const out = JSON.parse(sh("reins", ["open", url, "--json"]));
  if (typeof out.tabId !== "number")
    throw new Error(`reins open: no tabId in ${JSON.stringify(out)}`);
  return out.tabId;
}

const closeTab = (tab) => sh("reins", ["close", "--tab", String(tab)]);

/** Independent checker: `reins eval --json` prints `{ "value": <result> }`. */
function verify(tab, check) {
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

function timed(fn) {
  const t0 = performance.now();
  const out = fn();
  return { ms: Math.round(performance.now() - t0), out };
}

function runDo(task, tab) {
  const args = [
    "do",
    task.goal,
    ...Object.entries(task.fills).flatMap(([k, v]) => ["--fill", `${k}=${v}`]),
    "--tab",
    String(tab),
    "--json",
  ];
  return spawnSync("reins", args, { encoding: "utf8", timeout: 120_000 });
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
    "- Never navigate by URL (no reins nav, no reins eval): reach the result through the page's own UI.",
    "- Use only the step-by-step commands: reins snapshot, reins click, reins type, reins fill, reins press, reins select, reins text, reins wait, reins screenshot.",
    "- Do NOT use `reins do`.",
    "- Do not navigate away from the site the tab is on; work through its own UI (search box, buttons, filters).",
    "- Stop as soon as the task's end state is visible on the page. Reply with one line saying what is on screen.",
  ].join("\n");
}

/**
 * Least-permissive combination on claude 2.1.283:
 *   --restricted   ignores user/project settings (the user's allow all Bash) and strips code tools
 *   --tools Bash   adds Bash back, and nothing else
 *   --allowedTools "Bash(reins:*)"  auto-approves reins commands only
 *   --disallowedTools  denies `reins do` (keeps the arm manual) and the commands that
 *                      could touch other tabs or skip the UI (open/close/focus/nav/cdp/eval/group)
 *   --permission-prompts none  denies anything else instead of hanging on a prompt
 *   --disable-slash-commands  keeps the user's reins skill (which documents `reins do`) out
 */
const MANUAL_DENY = [
  "Bash(reins do:*)",
  "Bash(reins open:*)",
  "Bash(reins close:*)",
  "Bash(reins focus:*)",
  "Bash(reins nav:*)",
  "Bash(reins cdp:*)",
  "Bash(reins group:*)",
  "Bash(reins ungroup:*)",
  "Bash(reins eval:*)",
  "Bash(reins key:*)",
  "Bash(reins kill:*)",
  "Bash(reins restart:*)",
];
function runManual(task, tab) {
  const args = [
    "-p",
    manualPrompt(task, tab),
    "--restricted",
    "--tools",
    "Bash",
    "--allowedTools",
    "Bash(reins:*)",
    "--disallowedTools",
    ...MANUAL_DENY,
    "--permission-prompts",
    "none",
    "--disable-slash-commands",
    "--no-session-persistence",
    "--output-format",
    "json",
    "--max-budget-usd",
    String(opts["claude-budget-usd"]),
  ];
  return spawnSync("claude", args, { encoding: "utf8", timeout: 600_000 });
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

const results = [];
// Ctrl-C: spawnSync blocks the event loop, so the handler runs once the
// current child (which got the same SIGINT) returns; the run loop then stops,
// the tab is closed by the finally, and partial results are still written.
let stopping = false;
process.on("SIGINT", () => {
  if (stopping) process.exit(130);
  stopping = true;
  console.error("\nbench-do: interrupted — finishing this run's cleanup, writing partial results");
});

function safeClose(tab) {
  try {
    closeTab(tab);
  } catch (err) {
    console.error(`  close tab ${tab} failed: ${err instanceof Error ? err.message : err}`);
  }
}

console.log(`bench-do: ${tasks.length} task(s) × ${ARMS.join("+")} × ${RUNS} run(s)`);
outer: for (const task of tasks) {
  for (let i = 0; i < RUNS; i++) {
    for (const arm of ARMS) {
      if (stopping) break outer;
      const tab = openTab(task.url);
      try {
        runOne(task, arm, i, tab);
      } finally {
        safeClose(tab);
      }
    }
  }
}

function runOne(task, arm, i, tab) {
  spawnSync("sleep", ["2"]); // initial load is outside the clock in both arms
  const run = timed(() => (arm === "do" ? runDo(task, tab) : runManual(task, tab)));
  if (run.out.signal) stopping = true;
  const ok = verify(tab, task.check);
  const row = {
    task: task.id,
    arm,
    run: i + 1,
    ms: run.ms,
    verified: ok,
    exit: run.out.status,
  };
  const body = parseJson(run.out.stdout ?? "");
  if (arm === "do") {
    row.status = body?.status ?? (run.out.error ? "spawn_error" : "unparsed");
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
  if (run.out.error) row.error = run.out.error.message;
  else if (run.out.status !== 0 && !body) row.error = (run.out.stderr ?? "").trim().slice(0, 300);
  results.push(row);
  const extra =
    arm === "do"
      ? `${row.status} step=${row.step ?? "?"} jev=${row.jevCalls ?? "?"}`
      : `turns=${row.turns ?? "?"} $${row.costUsd?.toFixed?.(3) ?? "?"}`;
  console.log(`${task.id} ${arm} #${i + 1}: ${run.ms} ms ${ok ? "✓" : "✗"} (${extra})`);
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

const env = {
  at: new Date().toISOString(),
  node: process.version,
  reins: safeVersion("reins", ["--version"]),
  claude: ARMS.includes("manual") ? safeVersion("claude", ["--version"]) : undefined,
  runs: RUNS,
  arms: ARMS,
  partial: stopping,
};
function safeVersion(cmd, args) {
  try {
    return sh(cmd, args);
  } catch {
    return undefined;
  }
}
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
console.log(`\nwrote ${opts.out}${stopping ? " (partial: interrupted)" : ""}`);
if (stopping) process.exit(130);
