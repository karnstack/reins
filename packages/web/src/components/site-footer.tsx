import { Link } from "@tanstack/react-router";
import { LogoMark } from "@/components/logo";

export function SiteFooter() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
        <div className="flex items-center gap-3">
          <LogoMark className="size-5" />
          <p className="text-sm text-muted-foreground">reins · MIT licensed, open source.</p>
        </div>
        <nav className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <Link
            to="/docs"
            className="text-sm font-normal text-muted-foreground hover:text-foreground"
          >
            Docs
          </Link>
          <Link
            to="/privacy"
            className="text-sm font-normal text-muted-foreground hover:text-foreground"
          >
            Privacy
          </Link>
          <a
            href="https://github.com/karnstack/reins"
            className="text-sm font-normal text-muted-foreground hover:text-foreground"
            target="_blank"
            rel="noreferrer"
          >
            GitHub
          </a>
          <a
            href="https://www.npmjs.com/package/@karnstack/reins"
            className="text-sm font-normal text-muted-foreground hover:text-foreground"
            target="_blank"
            rel="noreferrer"
          >
            npm
          </a>
        </nav>
      </div>
    </footer>
  );
}
