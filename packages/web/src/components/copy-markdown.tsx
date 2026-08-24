import type { RefObject } from "react";
import { domToMarkdown } from "@/lib/dom-to-markdown";
import { useCopy } from "@/lib/use-copy";
import { cn } from "@/lib/utils";

/** A bracket link, like the nav. The page has no filled buttons. */
export function CopyMarkdown({
  contentRef,
  className,
}: {
  contentRef: RefObject<HTMLElement | null>;
  className?: string;
}) {
  const { copied, copy } = useCopy();

  function onClick() {
    const root = contentRef.current;
    if (!root) return;
    void copy(domToMarkdown(root));
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn("text-muted-foreground hover:text-foreground", className)}
    >
      <span aria-hidden="true">[ </span>
      {copied ? "copied" : "copy as markdown"}
      <span aria-hidden="true"> ]</span>
    </button>
  );
}
