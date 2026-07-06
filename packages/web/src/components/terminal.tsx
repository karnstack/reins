import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Terminal({
  title,
  children,
  className,
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl bg-neutral-950 shadow-xl ring-1 ring-black/10 dark:shadow-none dark:ring-white/10",
        className,
      )}
    >
      <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
        <span aria-hidden="true" className="size-2.5 rounded-full bg-white/20" />
        <span aria-hidden="true" className="size-2.5 rounded-full bg-white/20" />
        <span aria-hidden="true" className="size-2.5 rounded-full bg-white/20" />
        <p className="ml-2 font-mono text-xs text-neutral-500">{title}</p>
      </div>
      <div className="overflow-x-auto p-4 font-mono text-[0.8125rem]/6 whitespace-pre text-neutral-300">
        {children}
      </div>
    </div>
  );
}

export function Prompt({ children }: { children: ReactNode }) {
  return (
    <div>
      <span className="text-violet-400">$ </span>
      <span className="text-white">{children}</span>
    </div>
  );
}

export function Output({ children }: { children: ReactNode }) {
  return <div className="text-neutral-400">{children}</div>;
}
