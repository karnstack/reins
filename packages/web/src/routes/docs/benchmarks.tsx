import { createFileRoute } from "@tanstack/react-router";
import { Fragment } from "react";
import { A, Code, H1, H2, H3, P, Shell, Table, TEXT, Ul } from "@/components/md";
import { seo } from "@/lib/seo";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/docs/benchmarks")({
  head: () => ({
    ...seo({
      title: "Benchmarks · reins",
      description:
        "reins do (Jev) against Claude driving reins step by step: four browsing tasks, five runs each, measured wall-clock, model calls and cost, with every failure explained.",
      path: "/docs/benchmarks",
    }),
  }),
  component: BenchmarksPage,
});

const REPORT = "https://github.com/karnstack/reins/blob/main/docs/benchmarks/2026-09-reins-do.md";
const RAW_RUN1 =
  "https://github.com/karnstack/reins/blob/main/docs/benchmarks/2026-09-reins-do-run1.json";
const RAW_RUN2 =
  "https://github.com/karnstack/reins/blob/main/docs/benchmarks/2026-09-reins-do-run2-do.json";
const RAW_RUN3 =
  "https://github.com/karnstack/reins/blob/main/docs/benchmarks/2026-09-reins-do-run3-do.json";
const SCRIPT = "https://github.com/karnstack/reins/blob/main/packages/cli/scripts/bench-do.mjs";
const JEV_PRICING = "https://typesafe.ai/blog/introducing-system-one-models-and-jev";

/**
 * One row per task. `reins do` figures are from run 3, on the shipped build;
 * step-by-step figures are from run 1. Every number is a measured median over
 * verified runs (lower-middle median for even counts); nothing here is rounded
 * past what the raw JSON supports. `doRuns` names how many runs the `reins do`
 * median stands on when it is not a real median (github passed once).
 */
const TASKS: Array<{
  id: string;
  title: string;
  goal: string;
  check: string;
  doPassed: string;
  manualPassed: string;
  doMedianS: number;
  doRuns?: string;
  manualMedianS: number;
  speedup: string;
  jevCalls: number;
  jevTokens: string;
  jevCost: string;
  claudeCost: string;
  claudeTurns: number;
  costRatio: string;
}> = [
  {
    id: "flights",
    title: "flights",
    goal: "Google Flights: one-way Zurich to London on November 20, one adult, economy, until flight options are visible.",
    check:
      "The URL is still on Google Flights and carries an encoded search, the page shows a price, and it mentions Zurich (or ZRH), London and Nov 20.",
    doPassed: "3/5",
    manualPassed: "4/5",
    doMedianS: 8.9,
    manualMedianS: 71.1,
    speedup: "7.9x",
    jevCalls: 14,
    jevTokens: "109,981",
    jevCost: "$0.0046",
    claudeCost: "$0.57",
    claudeTurns: 29,
    costRatio: "~122x",
  },
  {
    id: "wikipedia",
    title: "wikipedia",
    goal: 'Wikipedia: find and open the article "Gödel\'s incompleteness theorems".',
    check: "The decoded pathname is exactly /wiki/Gödel's_incompleteness_theorems.",
    doPassed: "5/5",
    manualPassed: "5/5",
    doMedianS: 2.8,
    manualMedianS: 18.3,
    speedup: "6.5x",
    jevCalls: 4,
    jevTokens: "38,170",
    jevCost: "$0.0016",
    claudeCost: "$0.14",
    claudeTurns: 7,
    costRatio: "~88x",
  },
  {
    id: "cookies",
    title: "cookies",
    goal: "BBC Weather: dismiss any cookie or consent banner, then show the forecast for Zurich.",
    check:
      "The path is a forecast page, the title names Zurich, and no visible cookie or consent dialog is left. (From this machine's region BBC showed no consent banner at all, so that part is a guard, not the proof.)",
    doPassed: "5/5",
    manualPassed: "5/5",
    doMedianS: 2.3,
    manualMedianS: 17.3,
    speedup: "7.5x",
    jevCalls: 4,
    jevTokens: "26,130",
    jevCost: "$0.0011",
    claudeCost: "$0.16",
    claudeTurns: 7,
    costRatio: "~143x",
  },
  {
    id: "github",
    title: "github",
    goal: 'GitHub: search repositories for "browser automation" written in TypeScript, sorted by most stars.',
    check:
      "The query string contains browser, the URL carries language:TypeScript, the sort is by stars, and the results list has at least one repository.",
    doPassed: "1/5",
    manualPassed: "5/5",
    doMedianS: 6.3,
    doRuns: "1 run",
    manualMedianS: 29.3,
    speedup: "4.6x",
    jevCalls: 7,
    jevTokens: "80,369",
    jevCost: "$0.0034",
    claudeCost: "$0.19",
    claudeTurns: 14,
    costRatio: "~57x",
  },
];

/** The longest median on the page; every bar is drawn against it. */
const SCALE_S = 71.1;

/**
 * Flights, five runs on each build of the day that changed `reins do`. Shown
 * so the headline's 3/5 is read as one sample of a spread, not the number.
 */
const FLIGHTS_BY_BUILD: Array<[string, string]> = [
  ["run 1, before any fix", "4/5"],
  ["run 2, first fix wave", "5/5"],
  ["A/B, same code as run 2, later in the day", "5/5"],
  ["A/B, focus emulation only", "4/5"],
  ["run 3, shipped build", "3/5"],
];

/**
 * Two bars, one per arm, drawn to a shared scale so the four tasks compare
 * across headings as well as within them. The number sits beside each bar,
 * so the picture is never the only copy of the figure. A note beside the
 * `reins do` figure says when it stands on fewer runs than a median needs.
 */
function Bars({ doS, doNote, manualS }: { doS: number; doNote?: string; manualS: number }) {
  const rows: Array<[string, number, string | undefined]> = [
    ["reins do", doS, doNote],
    ["step by step", manualS, undefined],
  ];
  return (
    <div className={cn(TEXT, "mt-5 max-w-[68ch]")}>
      {rows.map(([label, s, note]) => (
        <div key={label} className="mt-1 flex items-center gap-3">
          <span className="w-24 shrink-0 text-muted-foreground">{label}</span>
          <span
            aria-hidden="true"
            className={cn("h-3 shrink-0", label === "reins do" ? "bg-primary" : "bg-foreground/25")}
            style={{ width: `${Math.max(1, (s / SCALE_S) * 100)}%` }}
          />
          <span className="tabular-nums whitespace-nowrap">
            {s.toFixed(1)} s{note ? <span className="text-muted-foreground"> ({note})</span> : null}
          </span>
        </div>
      ))}
    </div>
  );
}

function BenchmarksPage() {
  return (
    <>
      <H1>Benchmarks</H1>
      <P>
        <Code>reins do</Code> hands a whole browsing goal to TypeSafe's Jev model. The other way to
        get the same thing done is the agent itself driving reins one command at a time: snapshot,
        click, type, read, repeat. This page measures the two against each other on four tasks, in
        the maintainer's real Chrome, on 2026-09-27. Every number is measured; nothing is rounded in
        a flattering direction. The full report with every run is on GitHub:{" "}
        <A href={REPORT}>2026-09-reins-do.md</A>.
      </P>

      <H2 id="headline">Headline</H2>
      <P>
        On the three tasks Jev could route, one <Code>reins do</Code> call finished in 2.3 to 8.9 s
        where a step-by-step Claude session took 17.3 to 71.1 s: 6.5 to 7.9 times faster, and
        roughly 90 to 140 times cheaper in model spend. On the fourth task, a GitHub search with a
        language filter and a sort, <Code>reins do</Code> passed 1 out of 5 and step by step passed
        5 out of 5. Flights passed 3 out of 5 for <Code>reins do</Code> on the shipped build, and
        between 3 and 5 out of 5 across the day's builds. Both the speed and the misses are the
        result.
      </P>
      <Table
        rows={[
          ["Tasks", "4, each started in a fresh tab, 5 runs per arm"],
          ["reins do", "one call per run; Jev (TypeSafe System One, jev-1.12) picks each action"],
          [
            "Step by step",
            "claude -p (Claude Code 2.1.283, claude-opus-5-5) with reins step commands only",
          ],
          ["Passed", "reins do 14/20, step by step 19/20"],
          ["Model spend", "reins do: about $0.05 for 20 runs. Step by step: $5.71 for 20 runs."],
        ]}
      />

      <H2 id="results">Results</H2>
      <P>
        Medians over the runs that passed (lower-middle median for even counts). Seconds are
        wall-clock from the arm's start to its exit; the tab's initial 2 s load is outside the
        clock. The Claude cost is the whole session as Claude Code reports it. The Jev cost is only
        Jev: the agent that issues <Code>reins do</Code> still pays for its own turn to send the
        command, read the result and verify the page, and that turn is not in the table.
      </P>
      {TASKS.map((task) => (
        <Fragment key={task.id}>
          <H3 id={task.id}>{task.title}</H3>
          <P muted>{task.goal}</P>
          <Bars doS={task.doMedianS} doNote={task.doRuns} manualS={task.manualMedianS} />
          <Table
            rows={[
              ["Passed", `reins do ${task.doPassed}, step by step ${task.manualPassed}`],
              [
                "Median time",
                `reins do ${task.doMedianS.toFixed(1)} s${task.doRuns ? ` (${task.doRuns})` : ""}, step by step ${task.manualMedianS.toFixed(1)} s (${task.speedup} faster)`,
              ],
              [
                "Jev, per run",
                `${task.jevCalls} calls, ${task.jevTokens} input tokens, ${task.jevCost}`,
              ],
              ["Claude, per run", `${task.claudeTurns} turns, ${task.claudeCost}`],
              ["Cost ratio", task.costRatio],
              ["The check", task.check],
            ]}
          />
        </Fragment>
      ))}
      <P>
        The <Code>reins do</Code> figures are from run 3, on the build that shipped. The
        step-by-step arm does not depend on <Code>reins do</Code> code, so its run 1 numbers stand.
        The github time is its single passing run, one sample rather than a median; the github Jev
        figures are medians over all five attempts. The slowest step-by-step run was flights #3: 188
        s, 65 turns, $1.14.
      </P>
      <P>
        Earlier builds the same day: run 1, before any fix, had <Code>reins do</Code> at flights
        4/5, wikipedia 5/5, cookies 5/5, github 0/5, with medians of 7.7 s, 2.8 s and 2.2 s. Run 2,
        after the first fix wave, had flights 5/5, wikipedia 5/5, cookies 5/5, github 0/5, with
        medians of 7.5 s, 2.7 s and 2.3 s.
      </P>

      <H3 id="flights-spread">Flights across the day's builds</H3>
      <P>
        Flights was run five times on every build that changed <Code>reins do</Code>. The pass count
        moved with the build, and at five runs a build the spread is wide.
      </P>
      <Table rows={FLIGHTS_BY_BUILD} />
      <P>
        Read plainly: at n=5, flights sits somewhere between 60% and 100% for <Code>reins do</Code>,
        and the step-by-step arm was 4/5. The headline uses run 3 because that is the build that
        shipped, not because it is the best run. Every flights miss is the same one:{" "}
        <Code>stuck</Code> at step 11, "3 actions in a row changed nothing". Three extra{" "}
        <Code>reins do</Code> runs of flights right after run 3 all finished <Code>done</Code>; they
        were not checked, so they are not counted anywhere.
      </P>

      <H2 id="failures">Failures</H2>
      <P>
        <strong className="font-semibold">github, reins do 1/5.</strong> Jev types the query, then
        chooses the "advanced search" link to set the language filter. That page drops the typed
        query, so the final results are <Code>language:TypeScript</Code> sorted by stars but without
        "browser automation". Runs #1, #2 and #5 ended <Code>done</Code> this way and did not pass
        the check. Run #3 passed: the first <Code>reins do</Code> pass on this task. Run #4 ended{" "}
        <Code>error</Code> after 3 calls: TypeSafe returned an unusable answer and reins took no
        action, since it validates every Jev answer strictly and refuses to act on a malformed one.
      </P>
      <P>
        Why the runs flip: right after typing the query, Jev's operation probabilities are a near
        tie. Over three logged runs, CLICK on "advanced search" scored 0.31 to 0.35, BLOCKED 0.29 to
        0.32, and SUBMIT_SEARCH 0.17 to 0.21. reins has a SUBMIT_SEARCH operation (Enter in a
        search-like field), and Jev uses it for the plain goal: "Search GitHub repositories for
        'browser automation'" finishes in 2.4 s at the correct URL. With the filter and sort in the
        goal the top choice is the detour, by a small margin. A guard that submits when the top
        choice is under 0.5 fixed GitHub and cost flights (the A/B is under{" "}
        <A href="#changes">What changed during the benchmark</A>); two prompt rules changed nothing.
        All three were reverted. That is a model routing limit today. <Code>reins do</Code> reports{" "}
        <Code>done</Code> with the final URL, and its <Code>next:</Code> line says to verify, which
        is why a calling agent must check the page before trusting <Code>done</Code>.
      </P>
      <P>
        <strong className="font-semibold">flights, reins do, 2 misses.</strong> Run 3's #1 and #4
        ended <Code>stuck</Code> at step 11, the same miss run 1 hit once. The spread across builds
        is under <A href="#flights-spread">Flights across the day's builds</A>.
      </P>
      <P>
        <strong className="font-semibold">flights, step by step, 1 miss.</strong> Claude finished
        after 26 turns with the page not passing the check.
      </P>

      <H2 id="changes">What changed during the benchmark</H2>
      <P>
        The benchmark was run three times on the same day, and <Code>reins do</Code> changed between
        runs. Every change is on the branch; the reverted one is in the history.
      </P>
      <Ul>
        <li>
          After run 1: a SUBMIT_SEARCH operation (Enter in a search-like field), a settle wait after
          submit, a stop on stale retries, and token reporting in <Code>reins do --json</Code>.
        </li>
        <li>
          After run 2, page focus emulation. Tabs opened by <Code>reins open</Code> left Chrome's
          address bar focused, so <Code>document.hasFocus()</Code> was false in the page; the
          maintainer noticed the focused URL bar while watching a run. Every debugger attach now
          enables CDP focus emulation, so sites keyed off focus (GitHub's search combobox, password
          managers injecting text) see what a person sees.
        </li>
        <li>
          After run 2, a missed press is stale, not an error. A click that landed on a different
          element because the page changed under the pointer used to end a run with{" "}
          <Code>error</Code>; it is now a stale act, re-observed, with the stale counter applying.
        </li>
        <li>
          Tried and reverted: submit when unsure after typing, a guard that submits the typed search
          when Jev's top operation is under 0.5. It fixed the GitHub detour in isolation, but an A/B
          on flights (5 runs each, same day) said no: same code as run 2 5/5, focus emulation only
          4/5, focus plus guard 3/5, guard plus missed press as stale without focus 2/5, all three
          2/5. Two prompt rules ("submit before following links"; "a filter shown in the query or
          URL is already set") changed nothing on GitHub and were reverted too.
        </li>
      </Ul>

      <H2 id="meaning">What it means</H2>
      <Ul>
        <li>
          For goals Jev can route, one <Code>reins do</Code> call replaces a 7 to 29 turn
          step-by-step session: 6.5 to 7.9 times faster wall-clock and roughly 90 to 140 times
          cheaper in model spend on these tasks.
        </li>
        <li>
          The calling agent still pays for its own turn around <Code>reins do</Code> and for the
          verify step. The Claude column is a whole session; the Jev column is only Jev.
        </li>
        <li>
          Pass rates at n=5 move between builds. Flights went 4/5, 5/5, 5/5, 4/5, 3/5 across the
          day; the honest range is 60% to 100%, not one of those numbers.
        </li>
        <li>
          Step by step is more robust on multi-constraint searches (github). <Code>reins do</Code>{" "}
          stops instead of flailing (<Code>stuck</Code>, <Code>blocked</Code>,{" "}
          <Code>needs_text</Code>, <Code>risky_action</Code>, <Code>error</Code>) and hands back a{" "}
          <Code>next:</Code> line, so the fallback is cheap.
        </li>
        <li>
          Privacy: <Code>reins do</Code> sends page text and control labels to TypeSafe (see{" "}
          <A href="/docs/security#reins-do">reins do and TypeSafe</A> on the security page). Step by
          step sends page content to Anthropic via Claude. Either way it is opt-in, with your own
          key.
        </li>
      </Ul>

      <H2 id="method">Method in brief</H2>
      <P>
        Each run opens the task's start URL in a fresh tab of the user's real, logged-in Chrome,
        waits 2 s outside the clock, then times the arm until it exits. A run counts only when an
        independent JavaScript check on the final page passes and the arm finished on its own; a
        timeout never counts. The checks are listed under each task above and live in the script's
        TASKS array.
      </P>
      <Ul>
        <li>
          <Code>reins do</Code>:{" "}
          <Code>reins do "&lt;goal&gt;" --fill … --tab &lt;id&gt; --json</Code>. The calling agent
          spends nothing while it runs.
        </li>
        <li>
          Step by step: <Code>claude -p</Code> driving the same tab with reins step commands only
          (snapshot, click, type, fill, select, press, hover, scroll, wait, text, screenshot). One
          Bash call per command, <Code>--restricted</Code> with an explicit allowlist,{" "}
          <Code>reins do</Code> denied, no navigation by URL, a $2 cap per run. Its cost is Claude
          Code's reported <Code>total_cost_usd</Code>.
        </li>
        <li>
          Runs: 5 per task per arm. Run 1 (00:58 UTC) covered both arms. Run 2 (04:32 UTC) and run 3
          (07:26 UTC) re-ran the <Code>reins do</Code> arm, run 3 on the shipped build. The flights
          A/B runs sit between them.
        </li>
        <li>
          Machine: the maintainer's laptop (macOS), reins 0.5.0, on a residential network in India.
          TypeSafe says its service runs on the US West Coast, so every Jev call crossed the
          Pacific; the <Code>reins do</Code> times include that latency.
        </li>
      </Ul>

      <H2 id="pricing">Pricing</H2>
      <P>
        Jev pricing is from <A href={JEV_PRICING}>TypeSafe's own announcement</A> (read 2026-09-27):
        input tokens $0.042 per million, output tokens free. Token counts are the API's own{" "}
        <Code>usage.input_tokens</Code>, summed per run, which <Code>reins do --json</Code> now
        reports. Run 3 as a whole was 139 Jev calls and 1,140,290 input tokens, about $0.048:
        roughly 8,200 tokens and $0.00034 per call. TypeSafe notes it cannot prove the price is not
        subsidised.
      </P>

      <H2 id="reproduce">Reproduce</H2>
      <Shell lines={["$ node packages/cli/scripts/bench-do.mjs --runs 5"]} />
      <P>
        Needs a TypeSafe key (<Code>reins key set typesafe</Code>) and <Code>claude</Code> on PATH.
        It costs money on both arms and opens tabs in your real browser. The script is{" "}
        <A href={SCRIPT}>bench-do.mjs</A>; the raw results are <A href={RAW_RUN1}>run 1</A>,{" "}
        <A href={RAW_RUN2}>run 2</A> and <A href={RAW_RUN3}>run 3</A>.
      </P>
    </>
  );
}
