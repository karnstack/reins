import { AlignLeft } from "lucide-react";
import { type RefObject, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface TocItem {
  id: string;
  text: string;
  level: 2 | 3;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

/* Docs headings are plain JSX without ids, so the scan assigns slugs as it
   collects them. */
function useHeadings(contentRef: RefObject<HTMLElement | null>) {
  const [headings, setHeadings] = useState<Array<TocItem>>([]);

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;

    function scan() {
      const nodes = el?.querySelectorAll("article h2, article h3") ?? [];
      const seen = new Map<string, number>();
      const items: Array<TocItem> = [];
      nodes.forEach((node) => {
        const text = (node.textContent ?? "").trim();
        if (!text) return;
        if (!node.id) {
          const base = slugify(text) || "section";
          const count = seen.get(base) ?? 0;
          seen.set(base, count + 1);
          node.id = count === 0 ? base : `${base}-${count}`;
        }
        items.push({ id: node.id, text, level: node.tagName === "H2" ? 2 : 3 });
      });
      setHeadings((prev) =>
        prev.length === items.length &&
        prev.every((p, i) => p.id === items[i]?.id && p.text === items[i]?.text)
          ? prev
          : items,
      );
    }

    scan();
    const observer = new MutationObserver(scan);
    observer.observe(el, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [contentRef]);

  return headings;
}

function useActiveHeadings(headings: Array<TocItem>) {
  const [activeIds, setActiveIds] = useState<Set<string>>(new Set());
  const visibleRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (headings.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = visibleRef.current;

        for (const entry of entries) {
          if (entry.isIntersecting) {
            visible.add(entry.target.id);
          } else {
            visible.delete(entry.target.id);
          }
        }

        if (visible.size === 0) {
          // Nothing in view (e.g. inside a long section) — highlight the
          // heading closest to the top of the viewport.
          const viewTop = entries[0]?.rootBounds?.top ?? 0;
          let fallbackId: string | undefined;
          let minDist = Number.POSITIVE_INFINITY;

          for (const { id } of headings) {
            const el = document.getElementById(id);
            if (!el) continue;
            const dist = Math.abs(viewTop - el.getBoundingClientRect().top);
            if (dist < minDist) {
              minDist = dist;
              fallbackId = id;
            }
          }

          setActiveIds(fallbackId ? new Set([fallbackId]) : new Set());
        } else {
          setActiveIds(new Set(visible));
        }
      },
      { rootMargin: "-64px 0% -5% 0%", threshold: 0 },
    );

    headings.forEach(({ id }) => {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    });

    return () => {
      observer.disconnect();
      visibleRef.current.clear();
    };
  }, [headings]);

  return activeIds;
}

function getLineOffset(level: 2 | 3): number {
  return level === 3 ? 10 : 0;
}

function getItemOffset(level: 2 | 3): number {
  return level === 3 ? 28 : 16;
}

function calcThumb(container: HTMLElement, activeIds: Set<string>): [number, number] {
  if (activeIds.size === 0 || container.clientHeight === 0) return [0, 0];

  let upper = Number.MAX_VALUE;
  let lower = 0;

  for (const id of activeIds) {
    const el = container.querySelector<HTMLElement>(`a[data-id="${id}"]`);
    if (!el) continue;
    const styles = getComputedStyle(el);
    upper = Math.min(upper, el.offsetTop + Number.parseFloat(styles.paddingTop));
    lower = Math.max(
      lower,
      el.offsetTop + el.clientHeight - Number.parseFloat(styles.paddingBottom),
    );
  }

  if (upper === Number.MAX_VALUE) return [0, 0];
  return [upper, lower - upper];
}

interface DocsTocProps {
  contentRef: RefObject<HTMLElement | null>;
  className?: string;
}

export function DocsToc({ contentRef, className }: DocsTocProps) {
  const headings = useHeadings(contentRef);
  const activeIds = useActiveHeadings(headings);
  const listRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);

  const [svgData, setSvgData] = useState<{
    path: string;
    width: number;
    height: number;
  } | null>(null);

  useEffect(() => {
    const container = listRef.current;
    if (!container) return;

    function rebuild() {
      if (!container || container.clientHeight === 0) return;

      let w = 0;
      let h = 0;
      const d: Array<string> = [];

      headings.forEach((heading, i) => {
        const el = container.querySelector<HTMLElement>(`a[data-id="${heading.id}"]`);
        if (!el) return;

        const styles = getComputedStyle(el);
        const offset = getLineOffset(heading.level) + 1;
        const top = el.offsetTop + Number.parseFloat(styles.paddingTop);
        const bottom = el.offsetTop + el.clientHeight - Number.parseFloat(styles.paddingBottom);

        w = Math.max(offset, w);
        h = Math.max(h, bottom);

        d.push(`${i === 0 ? "M" : "L"}${offset} ${top}`);
        d.push(`L${offset} ${bottom}`);
      });

      setSvgData({ path: d.join(" "), width: w + 1, height: h });
    }

    rebuild();
    const observer = new ResizeObserver(rebuild);
    observer.observe(container);
    return () => observer.disconnect();
  }, [headings]);

  useEffect(() => {
    const container = listRef.current;
    const thumb = thumbRef.current;
    if (!container || !thumb) return;

    const [top, height] = calcThumb(container, activeIds);
    thumb.style.setProperty("--toc-top", `${top}px`);
    thumb.style.setProperty("--toc-height", `${height}px`);
    thumb.dataset.hidden = String(activeIds.size === 0);
  });

  if (headings.length === 0) return null;

  const svgMask = svgData
    ? `url("data:image/svg+xml,${encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgData.width} ${svgData.height}"><path d="${svgData.path}" stroke="black" stroke-width="1" fill="none" /></svg>`,
      )}")`
    : undefined;

  return (
    <nav className={cn("flex flex-col gap-3", className)} aria-label="On this page">
      <div className="-ml-0.5 flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <AlignLeft className="size-4 shrink-0" aria-hidden="true" />
        <span>On this page</span>
      </div>

      <div className="relative">
        {svgData && (
          <div
            className="pointer-events-none absolute start-0 top-0"
            style={{
              width: svgData.width,
              height: svgData.height,
              maskImage: svgMask,
              maskRepeat: "no-repeat",
            }}
          >
            <div className="absolute inset-0 bg-border" />
            <div
              ref={thumbRef}
              className={cn(
                "absolute w-full bg-primary",
                "top-[var(--toc-top)] h-[var(--toc-height)]",
                "transition-[top,height] duration-150 ease-linear",
                "data-[hidden=true]:opacity-0",
              )}
            />
          </div>
        )}

        <div ref={listRef} className="flex flex-col">
          {headings.map((heading) => {
            const isActive = activeIds.has(heading.id);

            return (
              <a
                key={heading.id}
                href={`#${heading.id}`}
                data-id={heading.id}
                onClick={(e) => {
                  e.preventDefault();
                  document.getElementById(heading.id)?.scrollIntoView({ behavior: "smooth" });
                  history.replaceState(null, "", `#${heading.id}`);
                }}
                style={{ paddingInlineStart: getItemOffset(heading.level) }}
                className={cn(
                  "relative block py-1.5 text-xs leading-snug transition-colors hover:text-foreground",
                  isActive ? "font-medium text-primary" : "text-muted-foreground",
                )}
              >
                {heading.text}
              </a>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
