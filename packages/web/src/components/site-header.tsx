import { Link } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { useEffect, useState } from "react";
import { CommandMenu } from "@/components/command-menu";
import { GitHubIcon } from "@/components/icons";
import { Column, TEXT } from "@/components/md";
import { ThemeToggle } from "@/components/theme-toggle";
import { REPO_URL } from "@/lib/site";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/docs", label: "docs" },
  { to: "/docs/commands", label: "commands" },
  { to: "/docs/permissions", label: "permissions" },
  { to: "/changelog", label: "changelog" },
] as const;

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return (
    !!el &&
    (el.isContentEditable ||
      el.tagName === "INPUT" ||
      el.tagName === "TEXTAREA" ||
      el.tagName === "SELECT")
  );
}

/** One line at the top. Not sticky: a document does not follow you down. */
export function SiteHeader() {
  const [cmdkOpen, setCmdkOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setCmdkOpen((v) => !v);
        return;
      }
      if (e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey && !isTyping(e.target)) {
        e.preventDefault();
        setCmdkOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <header data-pagefind-ignore>
      <Column className={cn(TEXT, "flex flex-wrap items-center gap-x-4 gap-y-2 py-6")}>
        <a href="/" aria-label="Homepage" className="font-semibold tracking-wide uppercase">
          reins
        </a>
        {/* Below `sm` the nav drops to its own line under the wordmark and the
            icons, rather than splitting the four across four lines. */}
        <nav className="flex flex-wrap items-center gap-x-3 max-sm:order-last max-sm:basis-full">
          {NAV.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className="text-muted-foreground hover:text-foreground"
              activeProps={{ className: "text-foreground" }}
              activeOptions={{ exact: item.to === "/docs" }}
            >
              <span aria-hidden="true">[ </span>
              {item.label}
              <span aria-hidden="true"> ]</span>
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() => setCmdkOpen(true)}
            aria-label="Search"
            className="inline-flex size-8 items-center justify-center text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <Search className="size-4 shrink-0" aria-hidden="true" />
          </button>
          <ThemeToggle />
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            aria-label="GitHub repository"
            className="inline-flex size-8 items-center justify-center text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <GitHubIcon className="size-4 shrink-0" />
          </a>
        </div>
      </Column>
      <CommandMenu open={cmdkOpen} onOpenChange={setCmdkOpen} />
    </header>
  );
}
