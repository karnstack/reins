import { Link } from "@tanstack/react-router";
import { Menu, Search, Star } from "lucide-react";
import { useEffect, useState } from "react";
import { CommandMenu } from "@/components/command-menu";
import { GitHubIcon, NpmIcon, XIcon } from "@/components/icons";
import { Wordmark } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { HEADER_LINKS, NPM_URL, REPO_URL, X_URL } from "@/lib/site";
import { formatStars, useGitHubStars } from "@/lib/use-github-stars";

const MOBILE_LINKS = [
  { to: "/docs", label: "Docs" },
  { to: "/docs/commands", label: "Commands" },
  { to: "/docs/permissions", label: "Permissions" },
  { to: "/docs/architecture", label: "Architecture" },
  { to: "/docs/security", label: "Security" },
  { to: "/changelog", label: "Changelog" },
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

function StarChip() {
  const stars = useGitHubStars();
  return (
    <a
      href={REPO_URL}
      target="_blank"
      rel="noreferrer"
      className="hidden h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground lg:inline-flex"
    >
      <GitHubIcon className="size-4 shrink-0" />
      <span className="tabular-nums">{stars != null ? formatStars(stars) : "Star"}</span>
      <Star className="size-3.5 shrink-0 fill-current" aria-hidden="true" />
    </a>
  );
}

export function SiteHeader() {
  const [cmdkOpen, setCmdkOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

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

  const openSearch = () => setCmdkOpen(true);

  return (
    <header
      data-pagefind-ignore
      className="sticky top-0 z-40 border-b border-border bg-background/75 backdrop-blur-md"
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-8">
          <a href="/" aria-label="Homepage">
            <Wordmark />
          </a>
          <nav className="flex items-center gap-6 max-lg:hidden">
            {HEADER_LINKS.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                className="text-sm text-muted-foreground hover:text-foreground"
                activeProps={{ className: "text-foreground" }}
                activeOptions={{ exact: link.to === "/docs" }}
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>

        <div className="flex flex-1 items-center justify-end gap-2">
          {/* Full search pill on the widest screens */}
          <button
            type="button"
            onClick={openSearch}
            className="hidden h-8 w-44 items-center gap-2 rounded-md border border-border bg-foreground/2 pr-1.5 pl-2.5 text-sm text-muted-foreground hover:bg-foreground/5 xl:flex"
          >
            <Search className="size-4 shrink-0" aria-hidden="true" />
            <span className="flex-1 text-left">Search</span>
            <kbd className="rounded border border-border bg-background px-1.5 py-px font-mono text-[0.6875rem]/4 text-muted-foreground">
              ⌘K
            </kbd>
          </button>
          {/* Compact search icon below xl (incl. mobile) */}
          <Button
            variant="ghost"
            size="icon"
            aria-label="Search"
            type="button"
            onClick={openSearch}
            className="xl:hidden"
          >
            <Search className="size-4.5" aria-hidden="true" />
          </Button>

          <StarChip />
          <ThemeToggle />

          <Button asChild size="sm" className="max-sm:hidden">
            <Link to="/docs">Get started</Link>
          </Button>

          {/* Mobile menu */}
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Open menu" className="lg:hidden">
                <Menu className="size-5" aria-hidden="true" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-80 gap-0 p-6">
              <SheetTitle className="sr-only">Menu</SheetTitle>
              <a href="/" aria-label="Homepage" onClick={() => setMobileOpen(false)}>
                <Wordmark />
              </a>

              <button
                type="button"
                onClick={() => {
                  setMobileOpen(false);
                  setCmdkOpen(true);
                }}
                className="mt-6 flex h-11 items-center gap-2 rounded-lg border border-border bg-foreground/2 px-3 text-base text-muted-foreground hover:bg-foreground/5"
              >
                <Search className="size-4 shrink-0" aria-hidden="true" />
                Search docs
              </button>

              <nav className="mt-6 flex flex-col">
                {MOBILE_LINKS.map((link) => (
                  <Link
                    key={link.to}
                    to={link.to}
                    onClick={() => setMobileOpen(false)}
                    className="-mx-2 rounded-md px-2 py-2.5 text-base text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
                    activeProps={{ className: "text-foreground" }}
                    activeOptions={{ exact: link.to === "/docs" }}
                  >
                    {link.label}
                  </Link>
                ))}
              </nav>

              <Button asChild size="lg" className="mt-6">
                <Link to="/docs" onClick={() => setMobileOpen(false)}>
                  Get started
                </Link>
              </Button>

              <div className="mt-6 flex items-center gap-1 border-t border-border pt-6">
                <a
                  href={REPO_URL}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="GitHub repository"
                  className="inline-flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <GitHubIcon className="size-4.5" />
                </a>
                <a
                  href={NPM_URL}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="npm package"
                  className="inline-flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <NpmIcon className="size-4.5" />
                </a>
                <a
                  href={X_URL}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="Karn on X"
                  className="inline-flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <XIcon className="size-4.5" />
                </a>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>

      <CommandMenu open={cmdkOpen} onOpenChange={setCmdkOpen} />
    </header>
  );
}
