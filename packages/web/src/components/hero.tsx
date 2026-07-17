import { Link } from "@tanstack/react-router";
import { Globe } from "lucide-react";
import { AnimatedTerminal, output, prompt } from "@/components/animated-terminal";
import { Button } from "@/components/ui/button";

const GITHUB_URL = "https://github.com/karnstack/reins";

/* The agent transcript shown inside the browser mock — kept short so it fits
   the docked panel and mirrors the highlighted e3/e7 refs on the page. */
const AGENT_PANEL_LINES = [
  prompt("reins snapshot"),
  output('  e3: input "Email"\n  e7: button "Sign in"'),
  prompt("reins click --ref e7"),
  output("  ✓ clicked e7"),
];

function RefChip({ id, className }: { id: string; className?: string }) {
  return (
    <span
      className={`absolute z-20 rounded-md bg-primary px-1.5 py-0.5 font-mono text-[0.6875rem] leading-none text-primary-foreground shadow-sm ${className ?? ""}`}
    >
      {id}
    </span>
  );
}

/* Small arrow cursor, positioned to look like it is about to click e7. */
function Cursor({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={`absolute z-20 size-4 drop-shadow-md ${className ?? ""}`}
      aria-hidden="true"
    >
      <path
        d="M1 1l4.5 13 2.2-5.3L13 6.5 1 1z"
        fill="white"
        stroke="black"
        strokeWidth="1"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Hero() {
  return (
    <section className="relative isolate overflow-hidden py-20 sm:py-24">
      <div aria-hidden="true" className="hero-grid pointer-events-none absolute inset-0 -z-10" />
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl text-center">
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-full border border-border bg-foreground/2 py-1 pr-3 pl-1.5 text-sm text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
          >
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
              Open source
            </span>
            MIT licensed, runs on 127.0.0.1
          </a>
          <h1 className="mx-auto mt-6 max-w-[20ch] font-display text-5xl font-semibold tracking-tight text-balance sm:text-6xl">
            Hand your agent the browser you already use
          </h1>
          <p className="mx-auto mt-5 max-w-[52ch] text-lg text-pretty text-muted-foreground">
            reins lets coding agents (Claude Code, Cursor, Codex, anything with a shell) drive the
            logged-in browser you already use. No debug profile, no launch flags, no MCP server to
            register.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <Button asChild size="lg">
              <Link to="/docs">Get started</Link>
            </Button>
            <Button asChild size="lg" variant="ghost">
              <a href={GITHUB_URL} target="_blank" rel="noreferrer">
                View on GitHub
              </a>
            </Button>
          </div>
        </div>

        {/* Browser window mock being driven by an agent. */}
        <div className="relative mx-auto mt-16 max-w-5xl">
          {/* Soft radial glow (blurred blob, not a rectangle). */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -top-10 left-1/2 -z-10 h-64 w-4/5 -translate-x-1/2 rounded-[50%] bg-primary/25 blur-[110px]"
          />
          <div className="rounded-xl border border-border bg-card shadow-2xl dark:shadow-none dark:inset-ring dark:inset-ring-white/10">
            {/* Chrome bar */}
            <div className="flex items-center gap-3 rounded-t-xl border-b border-border px-4 py-2.5">
              <div className="flex gap-1.5">
                <span className="size-2.5 rounded-full bg-[#ff5f57]" />
                <span className="size-2.5 rounded-full bg-[#febc2e]" />
                <span className="size-2.5 rounded-full bg-[#28c840]" />
              </div>
              <div className="mx-auto flex w-full max-w-sm items-center gap-2 rounded-md bg-foreground/5 px-3 py-1 font-mono text-xs text-muted-foreground">
                <Globe className="size-3.5 shrink-0" aria-hidden="true" />
                app.acme.com/checkout
              </div>
              <div className="w-11 shrink-0" />
            </div>
            {/* Debugging banner (mirrors Chrome's native one) */}
            <div className="flex items-center gap-2 border-b border-amber-500/20 bg-amber-500/10 px-4 py-1.5 text-xs text-amber-700 dark:text-amber-400">
              <span className="size-1.5 shrink-0 rounded-full bg-current" />
              <span className="truncate">reins is controlling this browser</span>
            </div>
            {/* Page body */}
            <div className="relative overflow-hidden rounded-b-xl">
              {/* faux site chrome */}
              <div className="flex items-center justify-between border-b border-border px-6 py-3">
                <div className="flex items-center gap-2">
                  <span className="size-4 rounded bg-foreground/15" />
                  <span className="h-2 w-14 rounded-full bg-foreground/10" />
                </div>
                <div className="flex items-center gap-4 max-sm:hidden">
                  <span className="h-2 w-10 rounded-full bg-foreground/10" />
                  <span className="h-2 w-10 rounded-full bg-foreground/10" />
                  <span className="h-5 w-14 rounded-md bg-foreground/10" />
                </div>
              </div>

              <div className="grid gap-8 p-8 sm:p-12 lg:min-h-88 lg:grid-cols-2 lg:items-center">
                {/* the page's sign-in form */}
                <div className="mx-auto w-full max-w-xs">
                  <p className="text-lg font-semibold">Sign in to Dashboard</p>
                  <p className="mt-1 text-sm text-muted-foreground">Welcome back.</p>
                  <div className="mt-6">
                    <p className="mb-1.5 text-xs font-medium text-muted-foreground">Email</p>
                    <div className="relative rounded-lg border border-primary/50 px-3 py-2 text-left font-mono text-xs ring-2 ring-primary/25">
                      <RefChip id="e3" className="-top-2.5 right-2" />
                      you@work.dev
                    </div>
                  </div>
                  <div className="mt-4">
                    <p className="mb-1.5 text-xs font-medium text-muted-foreground">Password</p>
                    <div className="rounded-lg border border-border px-3 py-2 text-left font-mono text-xs text-muted-foreground">
                      ••••••••••
                    </div>
                  </div>
                  <div className="relative mt-6">
                    <div className="relative rounded-lg bg-primary px-3 py-2.5 text-center text-sm font-medium text-primary-foreground ring-2 ring-primary/30">
                      <RefChip id="e7" className="-top-2.5 right-2 bg-neutral-950 text-white" />
                      Sign in
                    </div>
                    <Cursor className="right-6 -bottom-3" />
                  </div>
                </div>

                {/* the agent session driving it */}
                <div className="lg:pl-4">
                  <AnimatedTerminal
                    title="agent session"
                    lines={AGENT_PANEL_LINES}
                    startDelay={600}
                    className="shadow-xl"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
