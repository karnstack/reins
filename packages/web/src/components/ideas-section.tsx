import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatedTerminal, output, prompt, type TermLine } from "@/components/animated-terminal";
import { Reveal } from "@/components/reveal";
import { prefersReducedMotion, useInView } from "@/lib/motion";
import { cn } from "@/lib/utils";

interface Idea {
  id: string;
  chip: string;
  lines: TermLine[];
}

const IDEAS: Idea[] = [
  {
    id: "scrape",
    chip: "Scrape behind logins",
    lines: [
      prompt("reins open https://github.com/notifications"),
      prompt("reins text --max-chars 300"),
      output("  Notifications · 12 unread\n  ci: build failed on main — 2 mention you"),
    ],
  },
  {
    id: "test",
    chip: "Test as the logged-in user",
    lines: [
      prompt("reins nav localhost:3000/checkout"),
      prompt("reins snapshot"),
      output('  e2: input "Promo code"\n  e5: button "Apply"'),
      prompt('reins fill --ref e2 --value "SHIP50"'),
      prompt("reins click --ref e5"),
      prompt("reins screenshot"),
      output("  ~/.reins/shots/tab-4.png"),
    ],
  },
  {
    id: "api",
    chip: "Watch & replay API traffic",
    lines: [
      prompt("reins network --url /api/"),
      output("  POST /api/v1/orders     201  142ms\n  GET  /api/v1/orders/84  200   38ms"),
      prompt("reins eval 'fetch(\"/api/v1/orders/84\").then(r => r.json())' --await"),
      output('  { "id": 84, "status": "paid" }'),
    ],
  },
  {
    id: "dashboards",
    chip: "Drive dashboards & forms",
    lines: [
      prompt("reins tabs"),
      output("  b1  chrome  tab 7 *  Grafana — on-call"),
      prompt("reins click --selector '[data-panel=\"errors\"]'"),
      prompt("reins screenshot --full"),
      output("  ~/.reins/shots/tab-7.png"),
    ],
  },
  {
    id: "debug",
    chip: "Debug console & network",
    lines: [
      prompt("reins console --level error"),
      output("  TypeError: user.plan is undefined (app.js:214)"),
      prompt("reins network --since 60000"),
      output("  GET /api/me  500  88ms"),
    ],
  },
  {
    id: "cdp",
    chip: "Cookies & storage via CDP",
    lines: [
      prompt("reins cdp Network.getCookies"),
      output('  { "cookies": [ { "name": "session", … } ] }'),
      prompt("reins eval 'localStorage.getItem(\"theme\")'"),
      output('  "dark"'),
    ],
  },
];

const NEXT_IDEA_MS = 2800;

export function IdeasSection() {
  const { ref, inView } = useInView<HTMLDivElement>();
  const [index, setIndex] = useState(0);
  const timer = useRef<number | undefined>(undefined);
  const autoplay = !prefersReducedMotion();

  const handleDone = useCallback(() => {
    if (!autoplay) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setIndex((i) => (i + 1) % IDEAS.length), NEXT_IDEA_MS);
  }, [autoplay]);

  const pick = (i: number) => {
    window.clearTimeout(timer.current);
    setIndex(i);
  };

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const idea = IDEAS[index] ?? IDEAS[0];
  if (!idea) return null;

  return (
    <section ref={ref} className="py-20 sm:py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <Reveal>
          <p className="font-mono text-sm tracking-wide text-muted-foreground uppercase">
            Unlimited ideas
          </p>
          <h2 className="mt-3 max-w-[35ch] text-4xl font-semibold tracking-tight text-balance">
            One CLI, your whole browser
          </h2>
          <p className="mt-4 max-w-[56ch] text-pretty text-muted-foreground">
            Anything you can do signed in, your agent can do on request. A few loops to steal:
          </p>
        </Reveal>
        <Reveal
          delay={100}
          className="mt-10 grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] lg:gap-12"
        >
          <div className="flex flex-wrap gap-2 lg:flex-col lg:items-start">
            {IDEAS.map((item, i) => (
              <button
                key={item.id}
                type="button"
                aria-pressed={i === index}
                onClick={() => pick(i)}
                className={cn(
                  "rounded-full border px-4 py-2 text-left text-sm transition-colors",
                  i === index
                    ? "border-violet-600/40 bg-violet-600/10 text-foreground dark:border-violet-400/40 dark:bg-violet-400/10"
                    : "border-border text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
                )}
              >
                {item.chip}
              </button>
            ))}
          </div>
          {inView ? (
            <AnimatedTerminal
              key={idea.id}
              title="agent session"
              lines={idea.lines}
              onDone={handleDone}
              className="min-h-72"
            />
          ) : (
            <AnimatedTerminal
              title="agent session"
              lines={idea.lines}
              play={false}
              className="min-h-72"
            />
          )}
        </Reveal>
      </div>
    </section>
  );
}
