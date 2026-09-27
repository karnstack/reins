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
const SCRIPT = "https://github.com/karnstack/reins/blob/main/packages/cli/scripts/bench-do.mjs";
const JEV_PRICING = "https://typesafe.ai/blog/introducing-system-one-models-and-jev";

/**
 * One row per task. Every number is a measured median over verified runs
 * (lower-middle median for even counts); nothing here is rounded past what
 * the raw JSON supports. `doMedianS` is undefined where no run passed.
 */
const TASKS: Array<{
  id: string;
  title: string;
  goal: string;
  check: string;
  doPassed: string;
  manualPassed: string;
  doMedianS?: number;
  manualMedianS: number;
  speedup?: string;
  jevCalls: number;
  jevTokens: string;
  jevCost: string;
  claudeCost: string;
  claudeTurns: number;
  costRatio?: string;
}> = [
  {
    id: "flights",
    title: "flights",
    goal: "Google Flights: one-way Zurich to London on November 20, one adult, economy, until flight options are visible.",
    check:
      "The URL is still on Google Flights and carries an encoded search, the page shows a price, and it mentions Zurich (or ZRH), London and Nov 20.",
    doPassed: "5/5",
    manualPassed: "4/5",
    doMedianS: 7.5,
    manualMedianS: 71.1,
    speedup: "9.5x",
    jevCalls: 13,
    jevTokens: "99,690",
    jevCost: "$0.0042",
    claudeCost: "$0.57",
    claudeTurns: 29,
    costRatio: "~135x",
  },
  {
    id: "wikipedia",
    title: "wikipedia",
    goal: 'Wikipedia: find and open the article "Gödel\'s incompleteness theorems".',
    check: "The decoded pathname is exactly /wiki/Gödel's_incompleteness_theorems.",
    doPassed: "5/5",
    manualPassed: "5/5",
    doMedianS: 2.7,
    manualMedianS: 18.3,
    speedup: "6.7x",
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
    speedup: "7.6x",
    jevCalls: 4,
    jevTokens: "26,754",
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
    doPassed: "0/5",
    manualPassed: "5/5",
    manualMedianS: 29.3,
    jevCalls: 7,
    jevTokens: "80,327",
    jevCost: "$0.0034",
    claudeCost: "$0.19",
    claudeTurns: 14,
  },
];

/** The longest median on the page; every bar is drawn against it. */
const SCALE_S = 71.1;

/**
 * Two bars, one per arm, drawn to a shared scale so the four tasks compare
 * across headings as well as within them. The number sits beside each bar,
 * so the picture is never the only copy of the figure. A task no run passed
 * gets a label instead of a bar.
 */
function Bars({ doS, manualS }: { doS?: number; manualS: number }) {
  const rows: Array<[string, number | undefined]> = [
    ["reins do", doS],
    ["step by step", manualS],
  ];
  return (
    <div className={cn(TEXT, "mt-5 max-w-[68ch]")}>
      {rows.map(([label, s]) => (
        <div key={label} className="mt-1 flex items-center gap-3">
          <span className="w-24 shrink-0 text-muted-foreground">{label}</span>
          {s === undefined ? (
            <span className="text-muted-foreground">no run passed</span>
          ) : (
            <>
              <span
                aria-hidden="true"
                className={cn(
                  "h-3 shrink-0",
                  label === "reins do" ? "bg-primary" : "bg-foreground/25",
                )}
                style={{ width: `${Math.max(1, (s / SCALE_S) * 100)}%` }}
              />
              <span className="tabular-nums">{s.toFixed(1)} s</span>
            </>
          )}
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
        On the three tasks Jev could route, one <Code>reins do</Code> call finished in 2.3 to 7.5 s
        where a step-by-step Claude session took 17.3 to 71.1 s: 6.7 to 9.5 times faster, and
        roughly 90 to 140 times cheaper in model spend. On the fourth task, a GitHub search with a
        language filter and a sort, <Code>reins do</Code> failed 5 out of 5 and step by step passed
        5 out of 5. Both facts are the result.
      </P>
      <Table
        rows={[
          ["Tasks", "4, each started in a fresh tab, 5 runs per arm"],
          ["reins do", "one call per run; Jev (TypeSafe System One, jev-1.12) picks each action"],
          [
            "Step by step",
            "claude -p (Claude Code 2.1.283, claude-opus-5-5) with reins step commands only",
          ],
          ["Passed", "reins do 15/20, step by step 19/20"],
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
          <Bars doS={task.doMedianS} manualS={task.manualMedianS} />
          <Table
            rows={[
              ["Passed", `reins do ${task.doPassed}, step by step ${task.manualPassed}`],
              [
                "Median time",
                task.doMedianS === undefined
                  ? `reins do: no run passed. Step by step ${task.manualMedianS.toFixed(1)} s.`
                  : `reins do ${task.doMedianS.toFixed(1)} s, step by step ${task.manualMedianS.toFixed(1)} s (${task.speedup} faster)`,
              ],
              [
                "Jev, per run",
                `${task.jevCalls} calls, ${task.jevTokens} input tokens, ${task.jevCost}`,
              ],
              ["Claude, per run", `${task.claudeTurns} turns, ${task.claudeCost}`],
              ["Cost ratio", task.costRatio ?? "not comparable: no reins do run passed"],
              ["The check", task.check],
            ]}
          />
        </Fragment>
      ))}
      <P>
        The <Code>reins do</Code> figures are from run 2, after a fix wave (a SUBMIT_SEARCH
        operation, a settle wait after submit, a stop on stale retries, token reporting). Run 1 of
        the same day, before the fix, had <Code>reins do</Code> at flights 4/5, wikipedia 5/5,
        cookies 5/5, github 0/5, with medians of 7.7 s, 2.8 s and 2.2 s. The step-by-step arm does
        not depend on <Code>reins do</Code> code, so its run 1 numbers stand. The slowest
        step-by-step run was flights #3: 188 s, 65 turns, $1.14. The github row's Jev figures are
        medians over all five attempts, since none passed.
      </P>

      <H2 id="failures">Failures</H2>
      <P>
        <strong className="font-semibold">github, reins do 0/5.</strong> Jev types the query, then
        chooses the "advanced search" link to set the language filter. That page drops the typed
        query, so the final results are <Code>language:TypeScript</Code> sorted by stars but without
        "browser automation". reins now has a SUBMIT_SEARCH operation (Enter in a search-like
        field), and Jev uses it for the plain goal: "Search GitHub repositories for 'browser
        automation'" finishes in 2.4 s at the correct URL. With the filter and sort in the goal it
        takes the detour every time; the runs are deterministic. A prompt rule telling it to submit
        before following links did not change the choice. That is a model routing limit today.{" "}
        <Code>reins do</Code> reports <Code>done</Code> with the final URL, and its{" "}
        <Code>next:</Code> line says to verify, which is why a calling agent must check the page
        before trusting <Code>done</Code>. One run-2 github run ended <Code>blocked</Code> after 2
        calls.
      </P>
      <P>
        <strong className="font-semibold">flights, step by step, 1 miss.</strong> Claude finished
        after 26 turns with the page not passing the check.
      </P>
      <P>
        <strong className="font-semibold">flights, reins do, run 1.</strong> One run ended{" "}
        <Code>stuck</Code> at step 11. After the fix wave, run 2 was 5/5.
      </P>

      <H2 id="meaning">What it means</H2>
      <Ul>
        <li>
          For goals Jev can route, one <Code>reins do</Code> call replaces a 7 to 29 turn
          step-by-step session: 6.7 to 9.5 times faster wall-clock and roughly 90 to 140 times
          cheaper in model spend on these tasks.
        </li>
        <li>
          The calling agent still pays for its own turn around <Code>reins do</Code> and for the
          verify step. The Claude column is a whole session; the Jev column is only Jev.
        </li>
        <li>
          Step by step is more robust on multi-constraint searches (github). <Code>reins do</Code>{" "}
          stops instead of flailing (<Code>stuck</Code>, <Code>blocked</Code>,{" "}
          <Code>needs_text</Code>, <Code>risky_action</Code>) and hands back a <Code>next:</Code>{" "}
          line, so the fallback is cheap.
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
        reports. Run 2 as a whole was 139 Jev calls and 1,203,404 input tokens, about $0.05: roughly
        8,660 tokens and $0.00036 per call. TypeSafe notes it cannot prove the price is not
        subsidised.
      </P>

      <H2 id="reproduce">Reproduce</H2>
      <Shell lines={["$ node packages/cli/scripts/bench-do.mjs --runs 5"]} />
      <P>
        Needs a TypeSafe key (<Code>reins key set typesafe</Code>) and <Code>claude</Code> on PATH.
        It costs money on both arms and opens tabs in your real browser. The script is{" "}
        <A href={SCRIPT}>bench-do.mjs</A>; the raw results are <A href={RAW_RUN1}>run 1</A> and{" "}
        <A href={RAW_RUN2}>run 2</A>.
      </P>
    </>
  );
}
