import { useEffect, useState } from "react";
import { LogoMark } from "@/components/logo";
import { prefersReducedMotion, useInView } from "@/lib/motion";
import { cn } from "@/lib/utils";

type Tier = "full" | "read" | "deny";

const TIERS: Array<{ tier: Tier; label: string }> = [
  { tier: "full", label: "Full" },
  { tier: "read", label: "Read" },
  { tier: "deny", label: "Deny" },
];

function Segmented({ active }: { active: Tier }) {
  return (
    <span className="inline-flex rounded-lg border border-border bg-background p-0.5">
      {TIERS.map(({ tier, label }) => (
        <span
          key={tier}
          className={cn(
            "rounded-md px-2.5 py-1 text-xs font-medium transition-colors duration-300",
            tier === active ? "bg-primary text-primary-foreground" : "text-muted-foreground",
          )}
        >
          {label}
        </span>
      ))}
    </span>
  );
}

function RuleRow({ pattern, tier }: { pattern: string; tier: string }) {
  return (
    <li className="flex items-center justify-between py-1.5">
      <span className="font-mono text-xs">{pattern}</span>
      <span className="rounded-md bg-foreground/5 px-2 py-0.5 text-xs text-muted-foreground">
        {tier}
      </span>
    </li>
  );
}

/**
 * A stylized replica of the extension popup's Site permissions section. Purely
 * decorative: the real thing lives in the browser toolbar. When scrolled into
 * view, the current-site control walks full → read → deny.
 */
export function PopupMock({ className }: { className?: string }) {
  const { ref, inView } = useInView<HTMLDivElement>("0px 0px -25% 0px");
  const [tier, setTier] = useState<Tier>(() => (prefersReducedMotion() ? "deny" : "full"));

  useEffect(() => {
    if (!inView || prefersReducedMotion()) return;
    const a = window.setTimeout(() => setTier("read"), 1400);
    const b = window.setTimeout(() => setTier("deny"), 2800);
    return () => {
      window.clearTimeout(a);
      window.clearTimeout(b);
    };
  }, [inView]);

  return (
    <div
      ref={ref}
      aria-hidden="true"
      className={cn(
        "w-full max-w-sm rounded-2xl border border-border bg-card p-5 shadow-xl dark:shadow-none",
        className,
      )}
    >
      <div className="flex items-center gap-3">
        <LogoMark className="size-9" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">reins</p>
          <p className="truncate text-xs text-muted-foreground">
            Drive this browser from your agent
          </p>
        </div>
        <span className="flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
          <span className="size-1.5 rounded-full bg-current" />
          Connected
        </span>
      </div>

      <div className="mt-5 border-t border-border pt-4">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Site permissions
        </p>
        <div className="mt-3 flex items-center justify-between gap-3">
          <span className="truncate font-mono text-xs">mybank.com</span>
          <Segmented active={tier} />
        </div>
        <ul className="mt-3 divide-y divide-border border-t border-border">
          <RuleRow pattern="*.github.com" tier="Read" />
          <RuleRow pattern="localhost" tier="Full" />
        </ul>
        <div className="flex items-center justify-between border-t border-border pt-2.5">
          <span className="text-xs text-muted-foreground">Default for other sites</span>
          <span className="rounded-md bg-foreground/5 px-2 py-0.5 text-xs text-muted-foreground">
            Full
          </span>
        </div>
      </div>
    </div>
  );
}
