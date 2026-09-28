import { useState } from "react";
import { TEXT } from "@/components/md";
import { cn } from "@/lib/utils";

/**
 * The two benchmark charts, drawn in HTML so they reflow like the rest of the
 * page. reins do wears the site's violet and Claude an orange; the pair passes
 * the colorblind and contrast checks on both themes. Figures come from
 * docs/benchmarks/2026-09-reins-do.md.
 */
const DO = "bg-primary";
const CLAUDE = "bg-[#eb6834] dark:bg-[#d95926]";

function Legend() {
  return (
    <p className={cn(TEXT, "flex flex-wrap gap-x-5 text-muted-foreground")}>
      <span className="inline-flex items-center gap-2">
        <span aria-hidden="true" className={cn("size-2.5 rounded-full", DO)} />
        reins do
      </span>
      <span className="inline-flex items-center gap-2">
        <span aria-hidden="true" className={cn("size-2.5 rounded-full", CLAUDE)} />
        Claude, step by step
      </span>
    </p>
  );
}

const PASS: Array<{ set: string; bars: Array<[string, number, string]> }> = [
  {
    set: "8 unseen tasks",
    bars: [
      [DO, 87.5, "35/40"],
      [CLAUDE, 87.5, "21/24"],
    ],
  },
  {
    set: "30 tuned tasks",
    bars: [
      [DO, 82.6, "124/150"],
      [CLAUDE, 90, "81/90"],
    ],
  },
];

/** Share of runs passed, per set. */
export function PassChart() {
  return (
    <figure className="mt-5">
      <Legend />
      <div className="mt-4 space-y-4">
        {PASS.map((group) => (
          <div key={group.set}>
            <p className={cn(TEXT, "text-muted-foreground")}>{group.set}</p>
            <div className="mt-1 space-y-0.5">
              {group.bars.map(([color, pct, runs]) => (
                <div key={color} className="flex items-center gap-3">
                  <div className="relative h-2.5 flex-1">
                    <div
                      className={cn("absolute inset-y-0 left-0 rounded-r", color)}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className={cn(TEXT, "w-32 shrink-0 whitespace-nowrap tabular-nums")}>
                    {pct}% <span className="text-muted-foreground">{runs}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <figcaption className="sr-only">
        Runs passed. 8 unseen tasks: reins do 35 of 40, Claude 21 of 24, both 87.5%. 30 tuned tasks:
        reins do 124 of 150 (82.6%), Claude 81 of 90 (90%).
      </figcaption>
    </figure>
  );
}

/**
 * Median seconds of the passing runs, on the 30 tasks both passed at least
 * once, and the speed-up the report computes from the unrounded medians.
 */
const TIMES: Array<[string, number, number, string]> = [
  ["fx-form", 8.1, 141.5, "17.4x"],
  ["datecalc", 10.1, 115.7, "11.4x"],
  ["mdn", 4.8, 108.1, "22.6x"],
  ["flights", 15.9, 64.4, "4.0x"],
  ["rustdocs", 5.9, 46.8, "7.9x"],
  ["fx-settings", 3.4, 45.8, "13.5x"],
  ["lit", 7.7, 42.3, "5.4x"],
  ["fx-autocomplete", 3.9, 39.5, "10.2x"],
  ["github", 11.0, 34.6, "3.1x"],
  ["npm", 3.5, 31.7, "8.9x"],
  ["fx-consent", 5.3, 31.3, "5.9x"],
  ["pypi", 7.4, 30.1, "4.0x"],
  ["hnsearch", 8.9, 29.1, "3.2x"],
  ["cambridge", 6.5, 27.8, "4.2x"],
  ["crates", 6.7, 25.1, "3.7x"],
  ["debian", 4.5, 24.5, "5.4x"],
  ["pydocs", 5.9, 23.5, "3.9x"],
  ["amazon", 9.3, 23.2, "2.5x"],
  ["cookies", 8.5, 22.6, "2.6x"],
  ["gopkg", 9.1, 22.6, "2.4x"],
  ["osm", 6.4, 21.9, "3.4x"],
  ["fx-faq", 2.5, 21.4, "8.5x"],
  ["huggingface", 5.1, 21.3, "4.1x"],
  ["hackernews", 3.8, 20.0, "5.2x"],
  ["wikipedia", 4.1, 19.3, "4.6x"],
  ["gutenberg", 2.8, 19.0, "6.7x"],
  ["wolframalpha", 6.8, 18.9, "2.7x"],
  ["musicbrainz", 4.9, 17.4, "3.5x"],
  ["iana", 1.8, 13.5, "7.7x"],
  ["fx-risky", 0.7, 8.0, "12.2x"],
];
const MAX = 150;
const TICKS = [0, 50, 100, 150];
const pos = (s: number) => `${(s / MAX) * 100}%`;

/** One row per task: reins do's median run against Claude's. */
export function TimeChart() {
  const [active, setActive] = useState<number | null>(null);
  const row = active === null ? null : TIMES[active];

  return (
    <figure className="mt-5">
      <Legend />
      <p className={cn(TEXT, "mt-2 min-h-7 tabular-nums")} aria-hidden="true">
        {row ? (
          <>
            {row[0]}: {row[1]} s against {row[2]} s,{" "}
            <span className="font-semibold">{row[3]} faster</span>
          </>
        ) : (
          <span className="text-muted-foreground">Hover or tap a task for its numbers.</span>
        )}
      </p>
      <ul className="mt-2" onMouseLeave={() => setActive(null)}>
        {TIMES.map(([task, fast, slow], i) => (
          <li
            key={task}
            onMouseEnter={() => setActive(i)}
            className={cn(
              "grid grid-cols-[7.5rem_1fr] items-center gap-3 rounded-sm",
              active === i && "bg-muted",
            )}
          >
            <span className="sr-only">
              {task}: reins do {fast} s, Claude {slow} s.
            </span>
            <span
              aria-hidden="true"
              className={cn(
                TEXT,
                "truncate pl-1 text-muted-foreground",
                active === i && "text-foreground",
              )}
            >
              {task}
            </span>
            <span aria-hidden="true" className="relative h-5">
              {TICKS.map((t) => (
                <span
                  key={t}
                  className="absolute inset-y-0 w-px bg-border"
                  style={{ left: pos(t) }}
                />
              ))}
              <span
                className="absolute top-1/2 h-0.5 -translate-y-1/2 bg-muted-foreground/40"
                style={{ left: pos(fast), width: `${((slow - fast) / MAX) * 100}%` }}
              />
              <span
                className={cn(
                  "absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-background",
                  CLAUDE,
                )}
                style={{ left: pos(slow) }}
              />
              <span
                className={cn(
                  "absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-background",
                  DO,
                )}
                style={{ left: pos(fast) }}
              />
            </span>
          </li>
        ))}
      </ul>
      <div
        aria-hidden="true"
        className={cn(TEXT, "grid grid-cols-[7.5rem_1fr] gap-3 text-muted-foreground")}
      >
        <span />
        <span className="relative h-7">
          {TICKS.map((t) => (
            <span
              key={t}
              className={cn(
                "absolute whitespace-nowrap tabular-nums",
                t === 0 ? "" : t === MAX ? "-translate-x-full" : "-translate-x-1/2",
              )}
              style={{ left: pos(t) }}
            >
              {t === MAX ? `${t} s` : t}
            </span>
          ))}
        </span>
      </div>
      <figcaption className="sr-only">
        Median seconds per task for the 30 tasks both passed. reins do was faster on every one.
      </figcaption>
    </figure>
  );
}
