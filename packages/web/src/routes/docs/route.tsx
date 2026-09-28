import { createFileRoute, Link, Outlet, useLocation } from "@tanstack/react-router";
import { useRef } from "react";
import { CopyMarkdown } from "@/components/copy-markdown";
import { A, Column, Rule, TEXT, Ul } from "@/components/md";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/docs")({
  component: DocsLayout,
});

const NAV = [
  { to: "/docs", label: "Getting started", blurb: "install the CLI and extension, teach an agent" },
  { to: "/docs/sideload", label: "Install without the store", blurb: "Chrome's Load unpacked" },
  { to: "/docs/commands", label: "Commands", blurb: "the full reference" },
  { to: "/docs/permissions", label: "Site permissions", blurb: "deny, read and full" },
  { to: "/docs/architecture", label: "Architecture", blurb: "CLI, daemon, extension" },
  { to: "/docs/security", label: "Security", blurb: "the localhost-only model" },
  { to: "/docs/comparison", label: "How it compares", blurb: "next to the alternatives" },
  { to: "/docs/benchmarks", label: "Benchmarks", blurb: "reins do vs. step by step" },
  { to: "/docs/faq", label: "FAQ", blurb: "common questions" },
] as const;

/**
 * The shell every document shares: the way back, the page, the way on.
 *
 * One column, like the homepage. The sidebar and the floating table of
 * contents are gone: at this measure a document does not need a map of
 * itself, and the list at the foot is the map.
 */
function DocsLayout() {
  const { pathname } = useLocation();
  const contentRef = useRef<HTMLElement>(null);
  const others = NAV.filter((item) => item.to !== pathname.replace(/\/$/, ""));

  return (
    <>
      <SiteHeader />
      <main>
        <Column className="py-10">
          <p className={cn(TEXT, "flex flex-wrap items-center gap-x-4")}>
            <A href="/">&larr; reins.tech</A>
            <CopyMarkdown contentRef={contentRef} className="ml-auto" />
          </p>

          {/* An article, not a second <main>: the layout above already opens
              one, and two main landmarks on a page is one too many. */}
          <article ref={contentRef} data-pagefind-body className="mt-10">
            <Outlet />
          </article>

          <Rule />
          <p className={cn(TEXT, "mt-5 text-muted-foreground")}>Other pages</p>
          <Ul>
            {others.map((item) => (
              <li key={item.to}>
                <Link to={item.to} className="underline underline-offset-4 hover:text-primary">
                  {item.label}
                </Link>
                <span className="text-muted-foreground"> {item.blurb}</span>
              </li>
            ))}
          </Ul>
        </Column>
      </main>
      <SiteFooter />
    </>
  );
}
