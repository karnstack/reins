import { Link } from "@tanstack/react-router";
import { Wordmark } from "@/components/logo";

const GITHUB_URL = "https://github.com/karnstack/reins";

export function SiteHeader() {
  return (
    <header className="border-b border-border">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-8">
          <a href="/" aria-label="Homepage">
            <Wordmark />
          </a>
          <nav className="flex items-center gap-6 max-sm:hidden">
            <Link
              to="/docs"
              className="text-sm text-muted-foreground hover:text-foreground"
              activeProps={{ className: "text-foreground" }}
            >
              Docs
            </Link>
            <Link
              to="/docs/commands"
              className="text-sm text-muted-foreground hover:text-foreground"
              activeProps={{ className: "text-foreground" }}
            >
              Commands
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-6">
          <Link
            to="/docs"
            className="text-sm text-muted-foreground hover:text-foreground sm:hidden"
          >
            Docs
          </Link>
          <a
            href={GITHUB_URL}
            className="text-sm text-muted-foreground hover:text-foreground"
            target="_blank"
            rel="noreferrer"
          >
            GitHub
          </a>
        </div>
      </div>
    </header>
  );
}
