import { createFileRoute } from "@tanstack/react-router";
import { PassChart, TimeChart } from "@/components/bench-charts";
import { A, Code, H1, H2, H3, P, Shell, Table, Ul } from "@/components/md";
import { seo } from "@/lib/seo";

export const Route = createFileRoute("/docs/benchmarks")({
  head: () => ({
    ...seo({
      title: "Benchmarks · reins",
      description:
        "reins do (Jev) against Claude driving reins step by step on 38 browsing tasks: about as accurate, 4.6x faster and about 100x cheaper at the median.",
      path: "/docs/benchmarks",
    }),
  }),
  component: BenchmarksPage,
});

const GH = "https://github.com/karnstack/reins/blob/main";
const REPORT = `${GH}/docs/benchmarks/2026-09-reins-do.md`;
const SCRIPT = `${GH}/packages/cli/scripts/bench-do.mjs`;
const JEV_PRICING = "https://typesafe.ai/blog/introducing-system-one-models-and-jev";

function BenchmarksPage() {
  return (
    <>
      <H1>Benchmarks</H1>
      <P>
        <Code>reins do</Code> hands a whole browsing goal to TypeSafe's Jev model. The alternative
        is your agent driving reins itself: snapshot, click, type, repeat. We ran both on 38 tasks
        in a real Chrome on 2026-09-28, and scored both with the same check on the page each run
        ended on.
      </P>

      <H2 id="results">Results</H2>
      <P>
        About as accurate on tasks it had never seen, 4.6x faster and about 100x cheaper at the
        median. Neither side wins everywhere: each one fails tasks the other passes.
      </P>

      <H3 id="accuracy">Runs passed</H3>
      <PassChart />
      <P muted>
        The 30 tuned tasks are the ones <Code>reins do</Code> was fixed against over five rounds, so
        its score there flatters it. The 8 unseen tasks were run once, before anyone looked at them.
      </P>

      <H3 id="speed">Time per task</H3>
      <P>
        Median run on each of the 30 tasks both passed. <Code>reins do</Code> was faster on all 30,
        from 2.4x to 22.6x.
      </P>
      <TimeChart />

      <H3 id="cost">Cost</H3>
      <Table
        rows={[
          ["reins do", "$0.32 of Jev for 190 runs"],
          ["Claude", "$21.83 for 114 runs"],
          ["Median task", "111x cheaper with reins do"],
        ]}
      />
      <P muted>
        Jev's spend covers Jev only. Your agent still spends a turn sending the command and checking
        the result.
      </P>

      <H2 id="check-done">Check every done</H2>
      <P>
        <Code>reins do</Code> ends <Code>done</Code> when Jev thinks the goal is met, then asks Jev
        once more to confirm. 17 of 166 <Code>done</Code> runs were wrong, and all 17 came back
        marked <Code>unsure</Code>. So an unsure <Code>done</Code> is the one to look at before you
        report success. It is not proof of failure: 20 correct runs were marked unsure too.
      </P>

      <H2 id="limitations">Where each one fails</H2>
      <P>
        <Code>reins do</Code> never passed these:
      </P>
      <Ul>
        <li>A date picker. It picks the date and never presses the calendar's Done button.</li>
        <li>A search with filters. It sets the language filter before submitting, and loses it.</li>
        <li>arXiv. It opens a different paper whose title starts with the same words.</li>
        <li>A paginated table. The order is on page 2, and it gives up on page 1.</li>
        <li>
          xe.com. The site labels its input and its output the same, so the amount never lands.
        </li>
      </Ul>
      <P>Claude driving reins step by step never passed these:</P>
      <Ul>
        <li>Open Library. The sort menu and the search field sit inside web components.</li>
        <li>
          A modal wizard. Clicks on a custom radio card reported "zero size". This and Open Library
          were mostly gaps in <Code>reins snapshot</Code>, fixed in 0.6.1.
        </li>
        <li>A link that opens a new tab, because its rules forbade other tabs.</li>
      </Ul>
      <P muted>
        It is a small benchmark: 38 tasks, one machine, one day, from India to Jev's US servers.
        Live sites change. Jev input costs $0.042 per million tokens,{" "}
        <A href={JEV_PRICING}>TypeSafe's published price</A>. <Code>reins do</Code> sends page text
        to TypeSafe; <A href="/docs/security#reins-do">here is exactly what</A>.
      </P>

      <H2 id="reproduce">Run it yourself</H2>
      <Shell
        lines={[
          "$ node packages/cli/scripts/bench-do.mjs --arm do --set dev --runs 5 --out do.json",
          "$ node packages/cli/scripts/bench-do.mjs --arm manual --set all --runs 3 --out claude.json",
        ]}
      />
      <P>
        Needs a TypeSafe key (<Code>reins key set typesafe</Code>) and <Code>claude</Code> on your
        PATH. It opens tabs in your real browser for about two hours and spends about $22, nearly
        all of it on Claude. <Code>--dry</Code> checks the setup with no browser and no spend. The
        script is <A href={SCRIPT}>bench-do.mjs</A>.
      </P>

      <H2 id="full-report">Full report</H2>
      <P>
        Per-task numbers, how each task is checked, every fix and what it moved, the ones we
        reverted, and the traces behind each failure: <A href={REPORT}>2026-09-reins-do.md</A> on
        GitHub.
      </P>
    </>
  );
}
