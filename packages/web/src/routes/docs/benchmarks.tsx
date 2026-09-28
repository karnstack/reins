import { createFileRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { A, Code, H1, H2, H3, Ol, P, Shell, Table, TEXT, Ul } from "@/components/md";
import { seo } from "@/lib/seo";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/docs/benchmarks")({
  head: () => ({
    ...seo({
      title: "Benchmarks · reins",
      description:
        "reins do (Jev) against Claude driving reins step by step on 38 browsing tasks: pass rates on a tuned dev set and an unseen holdout, speed, cost, the self-check, and every limitation we know of.",
      path: "/docs/benchmarks",
    }),
  }),
  component: BenchmarksPage,
});

const GH = "https://github.com/karnstack/reins/blob/main";
const REPORT = `${GH}/docs/benchmarks/2026-09-reins-do.md`;
const SCRIPT = `${GH}/packages/cli/scripts/bench-do.mjs`;
const TASKS_FILE = `${GH}/packages/cli/scripts/bench/tasks.mjs`;
const JEV_PRICING = "https://typesafe.ai/blog/introducing-system-one-models-and-jev";

/**
 * One row per task, computed from the benchmark runs (dev on e9331fa, holdout3
 * on f1af855, Claude on all 38 tasks, with the three Claude fx-risky runs
 * scored by their page check); the raw run files aren't kept in the repo. Medians are over
 * passing runs, lower-middle for even counts. Jev cost is rounded up to the
 * next $0.00001 and Claude cost down to the $0.001; speed-up and cost ratio
 * come from unrounded medians and are truncated. `null` is "no passing run".
 * `note` points at the numbered notes under the tables.
 */
type Row = {
  id: string;
  tier: "fixture" | "live";
  set: "dev" | "holdout3";
  note?: string;
  doPassed: string;
  doS: string | null;
  jevTokens: string | null;
  jevCost: string | null;
  manualPassed: string;
  manualS: string | null;
  claudeCost: string | null;
  claudeTurns: number | null;
  speedup: string | null;
  costRatio: string | null;
};

const ROWS: Row[] = [
  {
    id: "fx-autocomplete",
    tier: "fixture",
    set: "dev",
    doPassed: "5/5",
    doS: "3.9",
    jevTokens: "8,339",
    jevCost: "$0.00036",
    manualPassed: "3/3",
    manualS: "39.5",
    claudeCost: "$0.144",
    claudeTurns: 15,
    speedup: "10.2x",
    costRatio: "413x",
  },
  {
    id: "fx-datepicker",
    tier: "fixture",
    set: "dev",
    doPassed: "0/5",
    doS: null,
    jevTokens: null,
    jevCost: null,
    manualPassed: "3/3",
    manualS: "25.1",
    claudeCost: "$0.087",
    claudeTurns: 12,
    speedup: null,
    costRatio: null,
  },
  {
    id: "fx-consent",
    tier: "fixture",
    set: "dev",
    doPassed: "5/5",
    doS: "5.3",
    jevTokens: "9,623",
    jevCost: "$0.00041",
    manualPassed: "3/3",
    manualS: "31.3",
    claudeCost: "$0.069",
    claudeTurns: 9,
    speedup: "5.9x",
    costRatio: "172x",
  },
  {
    id: "fx-filters",
    tier: "fixture",
    set: "dev",
    doPassed: "0/5",
    doS: null,
    jevTokens: null,
    jevCost: null,
    manualPassed: "3/3",
    manualS: "55.7",
    claudeCost: "$0.134",
    claudeTurns: 12,
    speedup: null,
    costRatio: null,
  },
  {
    id: "fx-newtab",
    tier: "fixture",
    set: "dev",
    note: "1",
    doPassed: "5/5",
    doS: "6.1",
    jevTokens: "12,993",
    jevCost: "$0.00055",
    manualPassed: "0/3",
    manualS: null,
    claudeCost: null,
    claudeTurns: null,
    speedup: null,
    costRatio: null,
  },
  {
    id: "fx-form",
    tier: "fixture",
    set: "dev",
    doPassed: "5/5",
    doS: "8.1",
    jevTokens: "22,227",
    jevCost: "$0.00094",
    manualPassed: "3/3",
    manualS: "141.5",
    claudeCost: "$0.324",
    claudeTurns: 40,
    speedup: "17.4x",
    costRatio: "347x",
  },
  {
    id: "fx-risky",
    tier: "fixture",
    set: "dev",
    note: "2",
    doPassed: "5/5",
    doS: "0.7",
    jevTokens: "1,361",
    jevCost: "$0.00006",
    manualPassed: "3/3",
    manualS: "8.0",
    claudeCost: "$0.030",
    claudeTurns: 2,
    speedup: "12.2x",
    costRatio: "535x",
  },
  {
    id: "flights",
    tier: "live",
    set: "dev",
    doPassed: "5/5",
    doS: "15.9",
    jevTokens: "105,994",
    jevCost: "$0.00446",
    manualPassed: "3/3",
    manualS: "64.4",
    claudeCost: "$0.559",
    claudeTurns: 28,
    speedup: "4.0x",
    costRatio: "125x",
  },
  {
    id: "wikipedia",
    tier: "live",
    set: "dev",
    doPassed: "5/5",
    doS: "4.1",
    jevTokens: "34,846",
    jevCost: "$0.00147",
    manualPassed: "3/3",
    manualS: "19.3",
    claudeCost: "$0.101",
    claudeTurns: 7,
    speedup: "4.6x",
    costRatio: "69x",
  },
  {
    id: "github",
    tier: "live",
    set: "dev",
    doPassed: "4/5",
    doS: "11.0",
    jevTokens: "51,100",
    jevCost: "$0.00215",
    manualPassed: "3/3",
    manualS: "34.6",
    claudeCost: "$0.170",
    claudeTurns: 17,
    speedup: "3.1x",
    costRatio: "79x",
  },
  {
    id: "cookies",
    tier: "live",
    set: "dev",
    doPassed: "5/5",
    doS: "8.5",
    jevTokens: "32,297",
    jevCost: "$0.00136",
    manualPassed: "3/3",
    manualS: "22.6",
    claudeCost: "$0.151",
    claudeTurns: 8,
    speedup: "2.6x",
    costRatio: "111x",
  },
  {
    id: "arxiv",
    tier: "live",
    set: "dev",
    doPassed: "0/5",
    doS: null,
    jevTokens: null,
    jevCost: null,
    manualPassed: "3/3",
    manualS: "53.0",
    claudeCost: "$0.291",
    claudeTurns: 25,
    speedup: null,
    costRatio: null,
  },
  {
    id: "npm",
    tier: "live",
    set: "dev",
    doPassed: "5/5",
    doS: "3.5",
    jevTokens: "16,441",
    jevCost: "$0.00070",
    manualPassed: "3/3",
    manualS: "31.7",
    claudeCost: "$0.150",
    claudeTurns: 9,
    speedup: "8.9x",
    costRatio: "217x",
  },
  {
    id: "mdn",
    tier: "live",
    set: "dev",
    note: "3",
    doPassed: "5/5",
    doS: "4.8",
    jevTokens: "32,335",
    jevCost: "$0.00136",
    manualPassed: "1/3",
    manualS: "108.1",
    claudeCost: "$0.492",
    claudeTurns: 34,
    speedup: "22.6x",
    costRatio: "362x",
  },
  {
    id: "cambridge",
    tier: "live",
    set: "dev",
    doPassed: "5/5",
    doS: "6.5",
    jevTokens: "25,691",
    jevCost: "$0.00108",
    manualPassed: "3/3",
    manualS: "27.8",
    claudeCost: "$0.107",
    claudeTurns: 9,
    speedup: "4.2x",
    costRatio: "100x",
  },
  {
    id: "huggingface",
    tier: "live",
    set: "dev",
    note: "3",
    doPassed: "1/5",
    doS: "5.1",
    jevTokens: "76,747",
    jevCost: "$0.00323",
    manualPassed: "3/3",
    manualS: "21.3",
    claudeCost: "$0.171",
    claudeTurns: 8,
    speedup: "4.1x",
    costRatio: "53x",
  },
  {
    id: "amazon",
    tier: "live",
    set: "dev",
    doPassed: "5/5",
    doS: "9.3",
    jevTokens: "38,873",
    jevCost: "$0.00164",
    manualPassed: "3/3",
    manualS: "23.2",
    claudeCost: "$0.165",
    claudeTurns: 9,
    speedup: "2.5x",
    costRatio: "101x",
  },
  {
    id: "hackernews",
    tier: "live",
    set: "dev",
    doPassed: "5/5",
    doS: "3.8",
    jevTokens: "48,945",
    jevCost: "$0.00206",
    manualPassed: "3/3",
    manualS: "20.0",
    claudeCost: "$0.133",
    claudeTurns: 8,
    speedup: "5.2x",
    costRatio: "65x",
  },
  {
    id: "wolframalpha",
    tier: "live",
    set: "dev",
    doPassed: "5/5",
    doS: "6.8",
    jevTokens: "36,208",
    jevCost: "$0.00153",
    manualPassed: "3/3",
    manualS: "18.9",
    claudeCost: "$0.068",
    claudeTurns: 7,
    speedup: "2.7x",
    costRatio: "44x",
  },
  {
    id: "pydocs",
    tier: "live",
    set: "dev",
    doPassed: "5/5",
    doS: "5.9",
    jevTokens: "46,391",
    jevCost: "$0.00195",
    manualPassed: "3/3",
    manualS: "23.5",
    claudeCost: "$0.114",
    claudeTurns: 10,
    speedup: "3.9x",
    costRatio: "58x",
  },
  {
    id: "pypi",
    tier: "live",
    set: "dev",
    doPassed: "5/5",
    doS: "7.4",
    jevTokens: "24,222",
    jevCost: "$0.00102",
    manualPassed: "3/3",
    manualS: "30.1",
    claudeCost: "$0.142",
    claudeTurns: 12,
    speedup: "4.0x",
    costRatio: "139x",
  },
  {
    id: "datecalc",
    tier: "live",
    set: "dev",
    doPassed: "4/5",
    doS: "10.1",
    jevTokens: "143,793",
    jevCost: "$0.00604",
    manualPassed: "3/3",
    manualS: "115.7",
    claudeCost: "$0.572",
    claudeTurns: 47,
    speedup: "11.4x",
    costRatio: "94x",
  },
  {
    id: "fx-settings",
    tier: "fixture",
    set: "dev",
    doPassed: "5/5",
    doS: "3.4",
    jevTokens: "8,795",
    jevCost: "$0.00037",
    manualPassed: "2/3",
    manualS: "45.8",
    claudeCost: "$0.136",
    claudeTurns: 17,
    speedup: "13.5x",
    costRatio: "369x",
  },
  {
    id: "fx-orders",
    tier: "fixture",
    set: "dev",
    doPassed: "0/5",
    doS: null,
    jevTokens: null,
    jevCost: null,
    manualPassed: "3/3",
    manualS: "23.7",
    claudeCost: "$0.084",
    claudeTurns: 10,
    speedup: null,
    costRatio: null,
  },
  {
    id: "lit",
    tier: "live",
    set: "dev",
    doPassed: "5/5",
    doS: "7.7",
    jevTokens: "38,667",
    jevCost: "$0.00163",
    manualPassed: "3/3",
    manualS: "42.3",
    claudeCost: "$0.203",
    claudeTurns: 18,
    speedup: "5.4x",
    costRatio: "125x",
  },
  {
    id: "musicbrainz",
    tier: "live",
    set: "dev",
    doPassed: "5/5",
    doS: "4.9",
    jevTokens: "60,964",
    jevCost: "$0.00257",
    manualPassed: "3/3",
    manualS: "17.4",
    claudeCost: "$0.127",
    claudeTurns: 8,
    speedup: "3.5x",
    costRatio: "49x",
  },
  {
    id: "openlibrary",
    tier: "live",
    set: "dev",
    doPassed: "5/5",
    doS: "14.6",
    jevTokens: "72,927",
    jevCost: "$0.00307",
    manualPassed: "0/3",
    manualS: null,
    claudeCost: null,
    claudeTurns: null,
    speedup: null,
    costRatio: null,
  },
  {
    id: "crates",
    tier: "live",
    set: "dev",
    doPassed: "5/5",
    doS: "6.7",
    jevTokens: "28,637",
    jevCost: "$0.00121",
    manualPassed: "3/3",
    manualS: "25.1",
    claudeCost: "$0.149",
    claudeTurns: 10,
    speedup: "3.7x",
    costRatio: "124x",
  },
  {
    id: "iana",
    tier: "live",
    set: "dev",
    doPassed: "5/5",
    doS: "1.8",
    jevTokens: "9,814",
    jevCost: "$0.00042",
    manualPassed: "3/3",
    manualS: "13.5",
    claudeCost: "$0.208",
    claudeTurns: 5,
    speedup: "7.7x",
    costRatio: "505x",
  },
  {
    id: "osm",
    tier: "live",
    set: "dev",
    doPassed: "5/5",
    doS: "6.4",
    jevTokens: "26,382",
    jevCost: "$0.00111",
    manualPassed: "3/3",
    manualS: "21.9",
    claudeCost: "$0.088",
    claudeTurns: 11,
    speedup: "3.4x",
    costRatio: "80x",
  },
  {
    id: "fx-faq",
    tier: "fixture",
    set: "holdout3",
    doPassed: "5/5",
    doS: "2.5",
    jevTokens: "8,796",
    jevCost: "$0.00037",
    manualPassed: "3/3",
    manualS: "21.4",
    claudeCost: "$0.114",
    claudeTurns: 8,
    speedup: "8.5x",
    costRatio: "310x",
  },
  {
    id: "fx-wizard",
    tier: "fixture",
    set: "holdout3",
    doPassed: "5/5",
    doS: "4.6",
    jevTokens: "13,056",
    jevCost: "$0.00055",
    manualPassed: "0/3",
    manualS: null,
    claudeCost: null,
    claudeTurns: null,
    speedup: null,
    costRatio: null,
  },
  {
    id: "gutenberg",
    tier: "live",
    set: "holdout3",
    doPassed: "5/5",
    doS: "2.8",
    jevTokens: "18,850",
    jevCost: "$0.00080",
    manualPassed: "3/3",
    manualS: "19.0",
    claudeCost: "$0.096",
    claudeTurns: 8,
    speedup: "6.7x",
    costRatio: "121x",
  },
  {
    id: "hnsearch",
    tier: "live",
    set: "holdout3",
    doPassed: "5/5",
    doS: "8.9",
    jevTokens: "72,835",
    jevCost: "$0.00306",
    manualPassed: "3/3",
    manualS: "29.1",
    claudeCost: "$0.184",
    claudeTurns: 13,
    speedup: "3.2x",
    costRatio: "60x",
  },
  {
    id: "debian",
    tier: "live",
    set: "holdout3",
    note: "4",
    doPassed: "5/5",
    doS: "4.5",
    jevTokens: "33,937",
    jevCost: "$0.00143",
    manualPassed: "3/3",
    manualS: "24.5",
    claudeCost: "$0.150",
    claudeTurns: 13,
    speedup: "5.4x",
    costRatio: "105x",
  },
  {
    id: "rustdocs",
    tier: "live",
    set: "holdout3",
    doPassed: "5/5",
    doS: "5.9",
    jevTokens: "45,163",
    jevCost: "$0.00190",
    manualPassed: "3/3",
    manualS: "46.8",
    claudeCost: "$0.288",
    claudeTurns: 15,
    speedup: "7.9x",
    costRatio: "151x",
  },
  {
    id: "gopkg",
    tier: "live",
    set: "holdout3",
    doPassed: "5/5",
    doS: "9.1",
    jevTokens: "30,018",
    jevCost: "$0.00127",
    manualPassed: "3/3",
    manualS: "22.6",
    claudeCost: "$0.099",
    claudeTurns: 10,
    speedup: "2.4x",
    costRatio: "79x",
  },
  {
    id: "xe",
    tier: "live",
    set: "holdout3",
    doPassed: "0/5",
    doS: null,
    jevTokens: null,
    jevCost: null,
    manualPassed: "3/3",
    manualS: "37.4",
    claudeCost: "$0.289",
    claudeTurns: 19,
    speedup: null,
    costRatio: null,
  },
];

/**
 * A table with a header row, for data with more than two columns. It scrolls
 * sideways inside its own box on a narrow screen so the page never does.
 */
function Grid({
  head,
  rows,
  wrap,
}: {
  head: string[];
  rows: Array<{ key: string; cells: ReactNode[] }>;
  wrap?: boolean;
}) {
  return (
    <div className="mt-5 overflow-x-auto">
      <table className={cn(TEXT, "w-full border-collapse tabular-nums")}>
        <thead>
          <tr className="border-b border-border">
            {head.map((h) => (
              <th
                key={h}
                scope="col"
                className="py-1.5 pr-4 text-left align-bottom font-normal whitespace-nowrap text-muted-foreground"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-b border-border">
              {row.cells.map((cell, i) => (
                <td
                  key={head[i]}
                  // In a wrapping table only the first and last columns (the
                  // prose ones) wrap; ids, commits and counts never break.
                  className={cn(
                    "py-1.5 pr-4 align-top",
                    wrap && (i === 0 || i === row.cells.length - 1)
                      ? "min-w-56"
                      : "whitespace-nowrap",
                  )}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const dash = (v: string | number | null, unit = "") => (v === null ? "-" : `${v}${unit}`);

function TaskTable({ set }: { set: Row["set"] }) {
  const rows = ROWS.filter((r) => r.set === set).sort((a, b) =>
    a.tier === b.tier ? 0 : a.tier === "fixture" ? -1 : 1,
  );
  return (
    <Grid
      head={[
        "task",
        "tier",
        "reins do passed",
        "reins do median",
        "Jev tokens",
        "Jev cost",
        "Claude passed",
        "Claude median",
        "Claude cost",
        "Claude turns",
        "speed-up",
        "cost ratio",
      ]}
      rows={rows.map((r) => ({
        key: r.id,
        cells: [
          <span key="id">
            {r.id}
            {r.note ? <span className="text-muted-foreground"> ({r.note})</span> : null}
          </span>,
          r.tier,
          r.doPassed,
          dash(r.doS, " s"),
          dash(r.jevTokens),
          dash(r.jevCost),
          r.manualPassed,
          dash(r.manualS, " s"),
          dash(r.claudeCost),
          dash(r.claudeTurns),
          dash(r.speedup),
          dash(r.costRatio),
        ],
      }))}
    />
  );
}

const TOTALS: Array<[string, string, string, string, string]> = [
  ["dev", "fixture", "30/45", "23/27", "23/24"],
  ["dev", "live", "94/105", "58/63", "58/63"],
  ["dev", "all", "124/150 (82.6%)", "81/90 (90%)", "81/87 (93.1%)"],
  ["holdout3", "fixture", "10/10", "3/6", "3/6"],
  ["holdout3", "live", "25/30", "18/18", "18/18"],
  ["holdout3", "all", "35/40 (87.5%)", "21/24 (87.5%)", "21/24"],
  ["both", "all", "159/190", "102/114", "102/111"],
];

/** Dev pass rate by round. The dev set grew as holdouts were folded in. */
const ROUNDS: Array<[string, string, string, string, string]> = [
  ["baseline", "7b9d105", "15 tasks × 3", "26/45 (57.7%)", ""],
  ["after round 1", "031e35c", "15 × 3", "33/45 (73.3%)", ""],
  ["after round 2", "307e204", "15 × 5", "61/75 (81.3%)", ""],
  ["holdout v1 run", "48c758d", "15 × 5", "58/75 (77.3%)", "holdout v1: 25/35 (71.4%)"],
  ["after round 3", "3c8a364", "22 × 5", "87/110 (79.0%)", "holdout2: 16/40 (40%)"],
  ["round 4 start", "3c8a364", "30 × 5", "101/150 (67.3%)", ""],
  ["after round 4", "f1af855", "30 × 5", "122/150 (81.3%)", "holdout3: 35/40 (87.5%)"],
  ["after round 5", "e9331fa", "30 × 5", "124/150 (82.6%)", ""],
];

/** Every kept change, with what it moved in its own A/B on the dev set. */
const KEPT: Array<[string, string, string, string]> = [
  [
    '"Accept" inside a cookie or consent banner is not a risky click',
    "ffdb1b9",
    "1",
    "26 to 27 of 45; consent walls like Cambridge's can be dismissed without the goal naming the button",
  ],
  [
    "The observation waits for a loading or navigating tab, and re-attaches after Chrome drops the debugger session",
    "384ce2b",
    "1",
    "amazon 1/3 to 3/3; datecalc's page became readable at all",
  ],
  [
    "A stop verdict right after typing a search query submits it first",
    "cc8217a",
    "1",
    'flights 1/3 to 2/3; github\'s "blocked with the query typed" runs became passes',
  ],
  [
    "After a click or a typed value, wait for the page to settle",
    "031e35c",
    "1",
    "flights 2/3 to 3/3, github 0/3 to 2/3, huggingface 1/3 to 2/3 (npm 3/3 to 2/3)",
  ],
  [
    "Type key by key, and resume after a dropped debugger session",
    "d3401e3",
    "2",
    "fields that rewrite their value on keyup keep it; 52 to 55 of 75, the gain on the noisy tasks",
  ],
  [
    "Name an unlabelled control by its table row or group, never by its options",
    "547849b",
    "2",
    "datecalc 0/20 to 8/10 over two runs (kept below the bar)",
  ],
  [
    "DONE self-check, then report-only",
    "307e204, 48c758d",
    "2",
    "no pass moved; refusing a DONE never changed an outcome, so it now only reports doneConfidence",
  ],
  [
    "A rounded-probability tie is not an unusable answer",
    "21a1fcf",
    "2 to 3",
    "removes an error stop seen in about 1 run in 6 in round 2",
  ],
  [
    "The observation reads open shadow roots",
    "08b668d",
    "3",
    "mdn 0/5 to 5/5 (kept below the bar)",
  ],
  [
    "A stuck run is self-checked and ends done when its page is the goal",
    "3c8a364",
    "3",
    "changed no outcome in its A/B; adds a self-check to stuck results",
  ],
  [
    "A control is named by what its shadow root or slot renders",
    "3c4e846",
    "4",
    "lit 0/5 to 4/5 (kept below the bar)",
  ],
  [
    "A link to a new tab is opened by the extension, not by Chrome",
    "a77ab0d",
    "4",
    "no pass change; Chrome no longer raises itself over the user's app when a run follows a target=_blank link",
  ],
  [
    "Off-screen pagers and controls named by a goal word are in the observation",
    "e9d0438",
    "4",
    "iana 0/5 to 5/5; +8% tokens per call",
  ],
  [
    "The observation waits for in-flight XHR and fetch requests",
    "47840f2",
    "4",
    "osm 2/5 to 5/5; median run +20%",
  ],
  [
    "No refocus click on the field just typed into, and clicks reach slotted web-component controls (a pair)",
    "f1af855",
    "4",
    "openlibrary 0/5 to 4/5; each half alone moved nothing",
  ],
  [
    "A leading www. never makes a different site",
    "8d69688",
    "5",
    "cannot move dev; debian left_site to done in a confirmation run (not counted)",
  ],
  [
    "A field whose fill head says NONE retargets to a field whose head names a fill",
    "e9331fa",
    "5",
    "fired on no dev run; did not fix xe",
  ],
];

function Label({ children }: { children: ReactNode }) {
  return <strong className="font-semibold">{children}</strong>;
}

function BenchmarksPage() {
  return (
    <>
      <H1>Benchmarks</H1>
      <P>
        <Code>reins do</Code> hands a whole browsing goal to TypeSafe's Jev model. The other way to
        get the same thing done is the agent itself driving reins one command at a time: snapshot,
        click, type, read, repeat. This page measures the two against each other on 38 tasks in the
        maintainer's real Chrome, on 2026-09-28. Both are scored by the same independent check on
        the page the run ended on. Every number is recomputed from the raw JSON, and nothing is
        rounded in a flattering direction. The full report is on GitHub:{" "}
        <A href={REPORT}>2026-09-reins-do.md</A>.
      </P>
      <P>
        <Label>
          Read the <A href="#limitations">limitations</A> before quoting a number.
        </Label>{" "}
        The dev figure is from a set the fixes were tuned on; the unseen figure is 8 tasks; and each
        arm fails tasks the other passes.
      </P>

      <H2 id="headline">Headline</H2>
      <Ul>
        <li>
          <Label>Dev set (30 tasks, tuned on for five rounds):</Label> <Code>reins do</Code> passed
          124 of 150 runs (82.6%). Claude step by step passed 81 of 90 (90%); 81 of 87 (93.1%)
          without fx-newtab, a task its rules made impossible.
        </li>
        <li>
          <Label>Unseen set (holdout3, 8 tasks, never looked at while fixing):</Label>{" "}
          <Code>reins do</Code> passed 35 of 40 runs (87.5%) on its first and only run. Claude step
          by step passed 21 of 24 (87.5%).
        </li>
        <li>
          <Label>Speed and cost, on the 30 tasks both arms passed at least once:</Label> the median
          task was 4.6x faster with <Code>reins do</Code> (range 2.4x to 22.6x) and 111x cheaper in
          model spend (range 44x to 535x). Pooled over those tasks' passing runs, the median{" "}
          <Code>reins do</Code> run took 5.7 s and the median Claude run 24.5 s. The cost counts
          only Jev; the calling agent's own turn is not in it.
        </li>
        <li>
          <Label>The self-check:</Label> of the 166 <Code>reins do</Code> runs that ended{" "}
          <Code>done</Code>, 17 were wrong, and all 17 carried a self-check under 0.5 ("unsure"); 20
          of the 149 right ones (13%) were marked unsure too.
        </li>
      </Ul>
      <Table
        rows={[
          ["Tasks", "38: 11 local fixture pages, 27 public sites; 30 dev, 8 holdout3"],
          ["reins do", "5 runs per task, one call per run; Jev picks each action"],
          [
            "Step by step",
            "3 runs per task; claude -p (Claude Code 2.1.283, claude-opus-5-5) with reins step commands only",
          ],
          ["Jev spend", "1,106 calls, 7,434,019 input tokens, about $0.32 for 190 runs"],
          ["Claude spend", "$21.83 for 114 runs"],
          [
            "Never passed",
            "reins do: fx-datepicker, fx-filters, arxiv, fx-orders, xe. Claude: openlibrary, fx-wizard (and fx-newtab, which it could not attempt)",
          ],
        ]}
      />

      <H2 id="results">Results</H2>
      <P>
        <Code>reins do</Code> columns: runs passed, then the median time, Jev input tokens and Jev
        cost of the passing runs. Claude columns: runs passed, then the median time, cost and turns
        of the passing runs. Speed-up and cost ratio are Claude's median over <Code>reins do</Code>
        's, shown only where both arms passed at least once. Times are wall-clock from spawn to
        exit, with the tab's initial 2 s load outside the clock. Numbers in brackets point at the
        notes below the tables.
      </P>
      <H3 id="dev">Dev set, 30 tasks</H3>
      <TaskTable set="dev" />
      <H3 id="holdout3">Holdout3, 8 unseen tasks</H3>
      <TaskTable set="holdout3" />
      <Ol>
        <li>
          fx-newtab is not a fair comparison. Its link opens the docs in a new tab, and the
          step-by-step prompt forbids touching any tab but the one it was given, so Claude stopped
          every time and said so. It is in the Claude totals, which are also given without it.
        </li>
        <li>
          fx-risky's correct outcome is a stop. <Code>reins do</Code> ended{" "}
          <Code>risky_action</Code> 5 of 5 times without clicking; Claude stopped before the delete
          3 of 3 times. The runner first scored those Claude runs as failures by a rule meant for{" "}
          <Code>reins do</Code>'s status; they are counted here by the page check, as the runner now
          does.
        </li>
        <li>
          One passing run only, so that median is a single sample: mdn's Claude figures,
          huggingface's <Code>reins do</Code> figures.
        </li>
        <li>
          Every debian run ended <Code>left_site</Code>, not <Code>done</Code>: the search form on
          www.debian.org submits to packages.debian.org, and on the holdout's code{" "}
          <Code>reins do</Code> stopped there as a site change. The page it stopped on was the goal,
          so the check passes. Round 5 treats a leading www. as the same site; a later confirmation
          run ended <Code>done</Code> 5 of 5 but is not counted, because a holdout is measured once.
        </li>
      </Ol>
      <Grid
        head={["set", "tier", "reins do", "Claude", "Claude without fx-newtab"]}
        rows={TOTALS.map((t) => ({ key: `${t[0]}-${t[1]}`, cells: t }))}
      />
      <P>
        Per set, the median task speed-up is 4.2x on dev (24 tasks) and 5.4x on holdout3 (6 tasks);
        the median cost ratio is 111x and 105x. On the same code as the holdout3 run (f1af855), the
        dev set scored 122/150 (81.3%).
      </P>
      <Ul>
        <li>
          <Code>reins do</Code>, dev: 901 Jev calls, 6,256,057 input tokens, $0.263.
        </li>
        <li>
          <Code>reins do</Code>, holdout3: 205 Jev calls, 1,177,962 input tokens, $0.050.
        </li>
        <li>
          Claude, all 38 tasks: 114 runs, 1,728 turns, $21.83. The dearest run was openlibrary #1
          (52 turns, $0.91, failed); the slowest was openlibrary #3 (318.9 s, failed).
        </li>
      </Ul>

      <H3 id="self-check">The self-check</H3>
      <P>
        Every <Code>done</Code> is put back to Jev once as a yes/no question (is every requirement
        in the goal visibly satisfied on this page?), and the answer's probability comes back as{" "}
        <Code>doneConfidence</Code>. Below 0.5 the output reads{" "}
        <Code>done (unsure: self-check 0.43)</Code> and the <Code>next:</Code> line says to verify.
        Recomputed from every <Code>done</Code> run of the dev and holdout3 runs:
      </P>
      <Grid
        head={["done runs", "right (check passed)", "wrong (check failed)"]}
        rows={[
          { key: "sure", cells: ["self-check 0.5 or more", "129", "0"] },
          { key: "unsure", cells: ['self-check under 0.5 ("unsure")', "20", "17"] },
          { key: "total", cells: ["total", "149", "17"] },
        ]}
      />
      <Ul>
        <li>
          The 17 wrong ones: fx-filters ×5 (0.32 to 0.49), fx-datepicker ×5 (0.12 to 0.14), arxiv ×5
          (0.38 to 0.45), github ×1 (0.44), huggingface ×1 (0.08). The highest, 0.49, sits one
          hundredth under the line.
        </li>
        <li>
          The 20 right-but-unsure ones are four whole tasks: cookies, fx-newtab, wolframalpha and
          gutenberg, 5 runs each (0.11 to 0.49). Unsure means "check the page", not "failed".
        </li>
      </Ul>

      <H3 id="step-by-step-failures">Where step by step failed and reins do passed</H3>
      <P>
        Read from each failed run's final reply. Several point at reins' own step commands rather
        than at Claude's reasoning: <Code>reins snapshot</Code>, which the step-by-step arm reads
        pages with, does not look inside shadow roots, while <Code>reins do</Code>'s observation
        does.
      </P>
      <Ul>
        <li>
          <Label>fx-newtab, 0/3.</Label> The link opens a new tab and the prompt forbids other tabs.
          Claude stopped and asked, in 3 to 4 turns.
        </li>
        <li>
          <Label>openlibrary, 0/3.</Label> Run 1 (52 turns, $0.91) searched but never opened the
          "Sort by" menu: its options are inside a web component and never appeared in a snapshot.
          Run 2 went through Advanced Search, landed on a "Verify you are human" page and stopped
          rather than click it. Run 3 never found the search field, which sits in a web component's
          modal.
        </li>
        <li>
          <Label>fx-wizard, 0/3.</Label> Runs 1 and 2: clicking the "Team" card came back "element
          has zero size", Next still advanced with the default Private, and Back and Close could not
          be used, so Claude stopped rather than create a Private project. Run 3 pressed Enter and
          then Space on "Create project", both worked, and it created the project twice; Claude
          noticed and said so.
        </li>
        <li>
          <Label>mdn, 1/3.</Label> Runs 2 and 3 never found MDN's search box (a web component): the
          search button reported zero size and <Code>reins press /</Code> was rejected as an unknown
          key. Run 1 got there in 34 turns.
        </li>
        <li>
          <Label>fx-settings, 2/3.</Label> Run 2 saw the switches without names, a click on the
          right one reported zero size, and a selector probe toggled a different switch; Claude
          stopped without saving and said which switch might have changed.
        </li>
      </Ul>
      <P>
        No step-by-step run hit its $2 cap or the 600 s limit; each failure is a stop Claude chose,
        with a reply saying why.
      </P>

      <H2 id="method">Method</H2>
      <Ul>
        <li>
          <Label>Fixture tier (11 tasks):</Label> local pages served by the runner, each built
          around one widget that trips browser agents: an autocomplete that only commits on a picked
          suggestion, a calendar popover with a Done button, a consent modal over a search, a search
          with a filter and a sort menu, a link to a new tab, a three-step form, a "Delete draft"
          button (the right outcome is a stop), a settings panel with switches and Save, a paginated
          table, an FAQ accordion with a vote, and a modal wizard with a custom radio group.
        </li>
        <li>
          <Label>Live tier (27 tasks):</Label> public sites, no logins, no purchases: Google
          Flights, Wikipedia, GitHub, BBC Weather, arXiv, npm, MDN, Cambridge Dictionary, Hugging
          Face, Amazon, Hacker News, Wolfram|Alpha, the Python docs, PyPI, a date calculator,
          lit.dev, MusicBrainz, Open Library, crates.io, IANA, OpenStreetMap, Project Gutenberg, HN
          Search, Debian packages, the Rust std docs, pkg.go.dev and xe.com.
        </li>
        <li>
          <Label>Checks:</Label> a JavaScript check per task, run in the tab the run ended on. Each
          was validated without <Code>reins do</Code>: false on the start page and on near-miss
          states (searched but not sorted, the wrong edition, a date picked but not confirmed), true
          on a goal state reached another way. They are in <A href={TASKS_FILE}>tasks.mjs</A>.
        </li>
        <li>
          <Label>A pass:</Label> the check returns true and the arm finished on its own inside its
          limit. A timeout never counts (none happened).
        </li>
        <li>
          <Label>reins do:</Label>{" "}
          <Code>reins do '&lt;goal&gt;' --fill … --timeout 60 --tab &lt;id&gt; --json</Code>, 90 s
          for four slow sites, at most 30 steps. 5 runs per task.
        </li>
        <li>
          <Label>Step by step:</Label> <Code>claude -p</Code> with the same goal and fill values,
          allowed only the reins step commands (snapshot, click, type, fill, select, press, hover,
          scroll, wait, text, screenshot), one per Bash call, <Code>--restricted</Code> with an
          allowlist, no <Code>reins do</Code>, no navigation by URL, no other tabs, stop before
          anything irreversible, $2 cap. 3 runs per task, because each costs about a hundred times
          more. Its cost is Claude Code's reported <Code>total_cost_usd</Code>.
        </li>
        <li>
          <Label>Dev and holdout:</Label> a holdout set is used once. After its first run it has
          been seen and its failures discussed, so it folds into dev: holdout v1 (7 tasks, 25/35)
          and holdout2 (8 tasks, 16/40) did. Holdout3 was frozen at f1af855 before any{" "}
          <Code>reins do</Code> run on it; its one run is the unseen number here, measured before
          round 5.
        </li>
        <li>
          <Label>Machine and network:</Label> the maintainer's Mac, reins 0.5.0, Node 24, on a
          residential network in India. Jev runs on the US West Coast, so every call crossed the
          Pacific, and the <Code>reins do</Code> times include that.
        </li>
        <li>
          <Label>Money:</Label> Jev input tokens at $0.042 per million, output free (
          <A href={JEV_PRICING}>TypeSafe's announcement</A>, read 2026-09-27; TypeSafe says it
          cannot prove the price is not subsidised). Tokens are the API's own count.
        </li>
        <li>
          <Label>Arithmetic:</Label> medians over passing runs, lower-middle for even counts. Jev
          cost rounded up, Claude cost rounded down, ratios truncated, so no rounding favours{" "}
          <Code>reins do</Code>.
        </li>
      </Ul>

      <H2 id="history">How it got here</H2>
      <P>
        <Code>reins do</Code> was tuned in five rounds on the dev set. Each change was tried alone
        and A/B'd on the whole dev set, and kept when the total rose by at least 3 runs, no task at
        4/5 or better fell below 3/5, and fx-risky still stopped every time. Three were kept below
        that bar on judgment, because their target moved from 0/5 and the drops elsewhere traced to
        unrelated coin flips. Tasks were only replaced or corrected when the task itself was broken,
        never because <Code>reins do</Code> failed them. The dev set grew as holdouts were folded
        in, so these rates are not one series on one set.
      </P>
      <Grid
        head={["stage", "code", "dev set", "dev result", "holdout first run"]}
        rows={ROUNDS.map((r) => ({ key: r[0], cells: r }))}
      />
      <Grid
        wrap
        head={["kept change", "commit", "round", "what it moved"]}
        rows={KEPT.map((k) => ({ key: k[1], cells: k }))}
      />
      <P>
        Round 5's total rose from 122 to 124, which the traces put down to noise: neither round-5
        mechanism fired on a dev task.
      </P>
      <P>Tried and reverted, each on its own A/B:</P>
      <Ul>
        <li>
          Observe settle without the re-attach: fx-form 3/3 to 1/3 (a password-manager frame drops
          the debugger session).
        </li>
        <li>
          Offer the "Open field" click only on fields that open something: flights 2/3 to 0/3.
        </li>
        <li>Stale-element guard scoped to row containers: no change.</li>
        <li>
          Page text joined per block, tried twice: arxiv's failure changed shape but did not pass.
        </li>
        <li>Key-by-key typing without the resume: fx-form 5/5 to 1/5.</li>
        <li>A 300 ms grace for a click's navigation to start: no gain.</li>
        <li>
          Stable select option ids, and refusing to re-select the current option: datecalc 4/5 to
          2/5 and 1/5.
        </li>
        <li>A stuck self-check that credits the run's recorded actions: no outcome changed.</li>
        <li>
          The refocus rule alone, and the slotted-click fix alone: no gain each; kept together.
        </li>
      </Ul>

      <H2 id="limitations">Limitations</H2>
      <P>
        <Label>Tasks reins do still fails, and why (from the traces):</Label>
      </P>
      <Ul>
        <li>
          <Label>fx-filters, 0/5.</Label> Jev types the query, clicks the TypeScript filter before
          submitting it (the page drops unsubmitted text, as GitHub does), sorts, retypes and
          submits. The final URL has the query and the sort but no language. Every run ends{" "}
          <Code>done</Code>, self-check 0.32 to 0.49.
        </li>
        <li>
          <Label>fx-datepicker, 0/5.</Label> Jev opens the calendar, goes forward two months, picks
          November 18, then answers DONE without pressing the calendar's Done button, which is in
          its observation. Every run ends <Code>done</Code>, self-check 0.12 to 0.14.
        </li>
        <li>
          <Label>arxiv, 0/5.</Label> Jev searches, then opens a different paper whose title starts
          with the same words. The wanted paper is not on the newest-first results page, and the
          sort control is offered and never chosen. Every run ends <Code>done</Code>, self-check
          0.38 to 0.45.
        </li>
        <li>
          <Label>fx-orders, 0/5.</Label> The order is on page 2. The pager is in the viewport and
          among Jev's candidates, and Jev answers BLOCKED (0.94 to 0.95) at step 0 every run. No
          self-check runs on a <Code>blocked</Code> stop.
        </li>
        <li>
          <Label>huggingface, 1/5.</Label> The page has two search boxes. In 4 runs Jev typed into
          the site-wide one, whose Enter opens the top model, then was <Code>stuck</Code> (×3,
          self-check 0.04) or said <Code>done</Code> there (×1, 0.08). The pass used the list's own
          "Filter by name" field.
        </li>
        <li>
          <Label>github, 4/5.</Label> The miss followed the "advanced search" link, which drops the
          typed query. After typing, Jev's choice between that link and giving up (which reins turns
          into a submit) is a near tie, so it flips from run to run.
        </li>
        <li>
          <Label>datecalc, 4/5.</Label> The miss clicked Calculate before setting the end day, then
          flipped the end-day select between 1 and 2 until the 30-step budget ran out.
        </li>
        <li>
          <Label>xe, 0/5 (holdout3).</Label> Stops <Code>needs_text</Code> at step 0: xe labels its
          amount input "Receiving amount", the same as the converted output, so no field matches the
          amount fill. A re-run with the currency fills the task first lacked was still 0/5.
          Unsolved.
        </li>
      </Ul>
      <Ul>
        <li>
          <Label>done is Jev's opinion.</Label> On this suite every wrong <Code>done</Code> was
          marked unsure, but that is 166 runs on 38 tasks, and the 17 wrong ones come from 5 tasks.
          Verify the page before reporting success.
        </li>
        <li>
          <Label>Every text value comes from --fill.</Label> <Code>reins do</Code> never makes up
          text; a field the fills do not cover stops the run with <Code>needs_text</Code>, and a
          site that mislabels its fields (xe) stops it even when the value was given.
        </li>
        <li>
          <Label>What it can see and do.</Label> It reads open shadow roots, never closed ones. A
          page that opens a tab from script (<Code>window.open</Code>) can still bring Chrome to the
          front. The risky-click stop is a heuristic on English words (buy, pay, send, delete…) and
          unlabelled buttons; other languages and odd labels can slip past it.
        </li>
        <li>
          <Label>A small benchmark.</Label> 38 tasks, one machine, one network, one day; n=5 for{" "}
          <Code>reins do</Code>, n=3 for Claude. A live site can change tomorrow. The fixture pages,
          the checks and every fix were written by Claude agents working for the maintainer.
        </li>
        <li>
          <Label>Tuned on dev.</Label> Five rounds of fixes were tuned on the dev set, so 82.6% is
          optimistic. The unseen 35/40 is the number that says how it generalises, and it was
          measured before round 5. It is 8 tasks: xe alone is 5 of its 40 runs, and its 5 debian
          passes ended <Code>left_site</Code> (note 4).
        </li>
        <li>
          <Label>What the cost leaves out.</Label> The Jev figure is only Jev: the calling agent
          still spends its own turn to issue the command, read the result and verify the page. The
          Claude figure is the whole session, including Claude Code's own system prompt and tool
          definitions (17 of 114 replies mention the maintainer's claude.ai connectors, so those
          were in context too).
        </li>
        <li>
          <Label>What the step-by-step arm measures.</Label> Claude plus reins' step commands, and
          some of its failures are the step commands' (<Code>reins snapshot</Code> does not read
          shadow roots). A better step toolkit, URL navigation or other tabs would score higher and
          change the speed and cost.
        </li>
        <li>
          <Label>Privacy.</Label> <Code>reins do</Code> sends the goal, your fill values, the URL
          and title, the visible text and the page's control labels to TypeSafe. The full list is
          under <A href="/docs/security#reins-do">reins do and TypeSafe</A> on the security page.
          Step by step sends page content to Anthropic. Either way it is opt-in.
        </li>
      </Ul>

      <H2 id="reproduce">Reproduce</H2>
      <Shell
        lines={[
          "$ REINS_JEV_TRACE=/tmp/jev-trace.jsonl reins restart",
          "$ node packages/cli/scripts/bench-do.mjs --arm do --set dev --runs 5 --trace /tmp/jev-trace.jsonl --out r5.json",
          "$ node packages/cli/scripts/bench-do.mjs --arm do --set holdout3 --runs 5 --out h3.json",
          "$ node packages/cli/scripts/bench-do.mjs --arm manual --set all --runs 3 --out manual-v2.json",
        ]}
      />
      <P>
        Other flags: <Code>--tier fixture|live</Code>, <Code>--tasks id1,id2</Code>,{" "}
        <Code>--claude-budget-usd</Code>, <Code>--out-dir</Code> and <Code>--dry</Code> (a self-test
        with no browser and no spend). It needs a TypeSafe key (<Code>reins key set typesafe</Code>)
        and <Code>claude</Code> on PATH. It costs money: about $0.32 of Jev for the 190 runs here
        and $21.83 of Claude for 114. It opens tabs in your real browser, in the foreground, for the
        whole run: about 25 minutes for dev, 5 for holdout3 and 90 for the Claude arm. Holdout3 is
        no longer unseen. The script is <A href={SCRIPT}>bench-do.mjs</A>. Raw run files aren't kept
        in the repo; these commands regenerate them.
      </P>

      <H2 id="v1">Earlier version of this benchmark</H2>
      <P>
        The first version (2026-09-27) ran 4 live tasks (flights, wikipedia, github, cookies) 5
        times per arm. On the build that shipped then, <Code>reins do</Code> passed 14/20 and Claude
        step by step 19/20; github was 1/5 for <Code>reins do</Code>, and on the tasks it passed{" "}
        <Code>reins do</Code> was 4.6x to 7.9x faster. It had no holdout and no fixture tier, which
        is why this version exists.
      </P>
    </>
  );
}
