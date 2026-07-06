import { Check, Copy } from "lucide-react";
import { highlightShell } from "@/lib/highlight";
import { useCopy } from "@/lib/use-copy";
import { cn } from "@/lib/utils";

export function CodeBlock({ code, className }: { code: string; className?: string }) {
  const { copied, copy } = useCopy();

  return (
    <div className={cn("relative", className)}>
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: shiki output from our own static strings */}
      <div dangerouslySetInnerHTML={{ __html: highlightShell(code) }} />
      <button
        type="button"
        onClick={() => copy(code)}
        aria-label="Copy code"
        className="absolute top-2 right-2 rounded-md p-2 text-neutral-400 hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
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
