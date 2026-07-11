import { createFileRoute, Link, Outlet, useLocation } from "@tanstack/react-router";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { CHANGELOGS, type PackageKey } from "@/lib/changelog";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/changelog")({
  component: ChangelogLayout,
});

const TABS: Array<{ key: PackageKey; to: string }> = [
  { key: "cli", to: "/changelog" },
  { key: "extension", to: "/changelog/extension" },
];

function ChangelogLayout() {
  const { pathname } = useLocation();
  const activeKey: PackageKey = pathname.includes("extension") ? "extension" : "cli";
  const changelog = CHANGELOGS[activeKey];

  return (
    <>
      <SiteHeader />
      <main className="mx-auto min-h-dvh max-w-6xl px-4 py-16 sm:px-6 lg:px-8">
        <h1 className="text-3xl font-semibold tracking-tight text-pretty">Changelog</h1>
        <p className="mt-3 max-w-[56ch] text-base/7 text-pretty text-muted-foreground">
          Release notes for the reins CLI and Chrome extension, straight from each package's
          changelog.
        </p>

        <div className="mt-10 flex items-end justify-between gap-4 border-b border-border">
          <nav className="-mb-px flex gap-6">
            {TABS.map((tab) => (
              <Link
                key={tab.key}
                to={tab.to}
                className={cn(
                  "border-b-2 pb-3 text-base sm:text-sm",
                  tab.key === activeKey
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {CHANGELOGS[tab.key].label}
              </Link>
            ))}
          </nav>
          <a
            href={changelog.distribution.href}
            target="_blank"
            rel="noreferrer"
            className="pb-3 font-mono text-xs text-muted-foreground hover:text-foreground max-sm:hidden"
          >
            {changelog.packageName}
          </a>
        </div>

        <Outlet />
      </main>
      <SiteFooter />
    </>
  );
}
