import { Check, Copy } from "lucide-react";
import { useCopy } from "@/lib/use-copy";
import { cn } from "@/lib/utils";

/**
 * The install line. It is selectable text first and a button second: with JS
 * off or still loading, the command is right there to highlight and copy by
 * hand, which is how a shell command should behave.
 */
export function CopyCommand({ command, className }: { command: string; className?: string }) {
  const { copied, copy } = useCopy();

  return (
    <div className={cn("flex items-center gap-3 border border-border py-2 pr-2 pl-4", className)}>
      <span aria-hidden="true" className="text-primary">
        $
      </span>
      <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap">{command}</code>
      <button
        type="button"
        onClick={() => copy(command)}
        aria-label={copied ? "Copied" : "Copy install command"}
        className="relative inline-flex size-8 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <span
          aria-hidden="true"
          className="absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-1/2 pointer-fine:hidden"
        />
        {copied ? (
          <Check className="size-4 shrink-0 text-primary" aria-hidden="true" />
        ) : (
          <Copy className="size-4 shrink-0" aria-hidden="true" />
        )}
      </button>
    </div>
  );
}
