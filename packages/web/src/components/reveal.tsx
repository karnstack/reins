import type { ReactNode } from "react";
import { prefersReducedMotion, useInView } from "@/lib/motion";
import { cn } from "@/lib/utils";

/** Fades and rises its children into view on first scroll into the viewport. */
export function Reveal({
  children,
  className,
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  const { ref, inView } = useInView<HTMLDivElement>();
  const shown = inView || prefersReducedMotion();

  return (
    <div
      ref={ref}
      style={delay > 0 ? { transitionDelay: `${delay}ms` } : undefined}
      className={cn(
        "transition-[opacity,translate] duration-700 ease-out",
        shown ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0",
        className,
      )}
    >
      {children}
    </div>
  );
}
