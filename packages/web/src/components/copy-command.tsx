import { Check, Copy } from "lucide-react";
import { useCopy } from "@/lib/use-copy";
import { cn } from "@/lib/utils";

export function CopyCommand({ command, className }: { command: string; className?: string }) {
  const { copied, copy } = useCopy();

  return (
    <div
      className={cn("flex items-center gap-3 rounded-lg bg-foreground/5 py-2 pr-2 pl-4", className)}
    >
      <p className="min-w-0 overflow-x-auto font-mono text-[0.8125rem]/6 whitespace-nowrap">
        <span aria-hidden="true" className="text-muted-foreground">
          ${" "}
        </span>
        {command}
      </p>
      <button
        type="button"
        onClick={() => copy(command)}
        aria-label="Copy command"
        className="relative rounded-md p-2 text-muted-foreground hover:bg-foreground/5 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <span
          className="absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-1/2 pointer-fine:hidden"
          aria-hidden="true"
        />
        {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
      </button>
    </div>
  );
}
