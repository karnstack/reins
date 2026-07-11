import { Check, Copy } from "lucide-react";
import type { RefObject } from "react";
import { Button } from "@/components/ui/button";
import { domToMarkdown } from "@/lib/dom-to-markdown";
import { useCopy } from "@/lib/use-copy";

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
    const article = root.querySelector("article") ?? root;
    void copy(domToMarkdown(article as HTMLElement));
  }

  return (
    <Button variant="outline" size="sm" onClick={onClick} className={className}>
      {copied ? (
        <Check className="size-3.5" aria-hidden="true" />
      ) : (
        <Copy className="size-3.5" aria-hidden="true" />
      )}
      {copied ? "Copied" : "Copy as Markdown"}
    </Button>
  );
}
