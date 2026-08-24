import { Globe } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A picture of an agent driving a tab.
 *
 * The one drawing on the homepage, and it sits in the flow where a README
 * would put a screenshot. It is set in `font-sans` and keeps its corners on
 * purpose: it is a picture of a browser, and a browser has both. Everything
 * around it is mono and square.
 */

function RefChip({ id, className }: { id: string; className?: string }) {
  return (
    <span
      className={cn(
        "absolute z-20 bg-primary px-1.5 py-0.5 font-mono text-[0.6875rem] leading-none text-primary-foreground",
        className,
      )}
    >
      {id}
    </span>
  );
}

/* Small arrow cursor, positioned to look like it is about to click e7. */
function Cursor({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={cn("absolute z-20 size-4", className)} aria-hidden="true">
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

const AGENT_LINES = [
  "$ reins snapshot",
  '  e3: input "Email"',
  '  e7: button "Sign in"',
  "$ reins click --ref e7",
  "  ✓ clicked e7",
];

export function BrowserMock({ className }: { className?: string }) {
  return (
    <div className={cn("font-sans", className)}>
      <div className="rounded-xl border border-border bg-card dark:bg-neutral-950">
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

        {/* Debugging banner, mirroring Chrome's native one */}
        <div className="flex items-center gap-2 border-b border-amber-500/20 bg-amber-500/10 px-4 py-1.5 text-xs text-amber-700 dark:border-amber-300/20 dark:bg-amber-300/8 dark:text-amber-300">
          <span className="size-1.5 shrink-0 rounded-full bg-current" />
          <span className="truncate">reins is controlling this browser</span>
        </div>

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

          <div className="grid gap-8 p-6 sm:p-8 lg:grid-cols-2 lg:items-center">
            {/* the page's sign-in form */}
            <div className="mx-auto w-full max-w-xs">
              <p className="text-lg font-semibold">Sign in to Dashboard</p>
              <p className="mt-1 text-sm text-muted-foreground">Welcome back.</p>
              <div className="mt-6">
                <p className="mb-1.5 text-xs font-medium text-muted-foreground">Email</p>
                <div className="relative border border-primary/50 px-3 py-2 text-left font-mono text-xs">
                  <RefChip id="e3" className="-top-2.5 right-2" />
                  you@work.dev
                </div>
              </div>
              <div className="mt-4">
                <p className="mb-1.5 text-xs font-medium text-muted-foreground">Password</p>
                <div className="border border-border px-3 py-2 text-left font-mono text-xs text-muted-foreground">
                  ••••••••••
                </div>
              </div>
              <div className="relative mt-6">
                <div className="relative bg-primary px-3 py-2.5 text-center text-sm font-medium text-primary-foreground">
                  <RefChip id="e7" className="-top-2.5 right-2 bg-neutral-950 text-white" />
                  Sign in
                </div>
                <Cursor className="right-6 -bottom-3" />
              </div>
            </div>

            {/* the agent session driving it */}
            <pre className="overflow-x-auto border border-border p-4 font-mono text-xs/6 whitespace-pre">
              {AGENT_LINES.map((line) => (
                <span key={line} className="block">
                  {line.startsWith("$") ? (
                    <>
                      <span className="text-primary">$</span>
                      {line.slice(1)}
                    </>
                  ) : (
                    <span className="text-muted-foreground">{line}</span>
                  )}
                </span>
              ))}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
