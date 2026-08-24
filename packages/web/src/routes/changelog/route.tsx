import { createFileRoute, Link, Outlet, useLocation } from "@tanstack/react-router";
import { A, Column, H1, P, TEXT } from "@/components/md";
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
      <main>
        <Column className="py-10">
          <p className={TEXT}>
            <A href="/">&larr; reins.tech</A>
          </p>
          <div className="mt-10">
            <H1>Changelog</H1>
          </div>
          <P>
            Release notes for the reins CLI and the Chrome extension, straight from each package's
            changelog.
          </P>

          <p className={cn(TEXT, "mt-5 flex flex-wrap items-center gap-x-3")}>
            {TABS.map((tab) => (
              <Link
                key={tab.key}
                to={tab.to}
                className={
                  tab.key === activeKey
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }
              >
                <span aria-hidden="true">[ </span>
                {CHANGELOGS[tab.key].label}
                <span aria-hidden="true"> ]</span>
              </Link>
            ))}
            <a
              href={changelog.distribution.href}
              target="_blank"
              rel="noreferrer"
              className="ml-auto text-muted-foreground hover:text-foreground"
            >
              {changelog.packageName}
            </a>
          </p>

          <Outlet />
        </Column>
      </main>
      <SiteFooter />
    </>
  );
}
