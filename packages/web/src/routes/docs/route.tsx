import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { Menu } from "lucide-react";
import { useState } from "react";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

export const Route = createFileRoute("/docs")({
  component: DocsLayout,
});

const NAV = [
  { to: "/docs", label: "Getting started", exact: true },
  { to: "/docs/sideload", label: "Install without the store", exact: false },
  { to: "/docs/commands", label: "Commands", exact: false },
  { to: "/docs/permissions", label: "Site permissions", exact: false },
  { to: "/docs/architecture", label: "Architecture", exact: false },
  { to: "/docs/security", label: "Security", exact: false },
  { to: "/docs/comparison", label: "How it compares", exact: false },
  { to: "/docs/faq", label: "FAQ", exact: false },
] as const;

function DocsNav({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="flex flex-col gap-1">
      {NAV.map((item) => (
        <Link
          key={item.to}
          to={item.to}
          activeOptions={{ exact: item.exact ?? false }}
          onClick={onNavigate}
          className="rounded-md px-3 py-2 text-base/6 text-muted-foreground hover:bg-foreground/5 hover:text-foreground sm:py-1.5 sm:text-sm/6"
          activeProps={{ className: "bg-foreground/5 text-foreground" }}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

function DocsLayout() {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <>
      <SiteHeader />
      <div className="border-b border-border lg:hidden">
        <div className="mx-auto max-w-6xl px-4 py-2 sm:px-6">
          <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="sm">
                <Menu aria-hidden="true" className="size-4" />
                Docs menu
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 p-4 pt-12">
              <SheetTitle className="sr-only">Documentation navigation</SheetTitle>
              <DocsNav onNavigate={() => setMobileNavOpen(false)} />
            </SheetContent>
          </Sheet>
        </div>
      </div>
      <div className="mx-auto flex min-h-dvh max-w-6xl gap-12 px-4 sm:px-6 lg:px-8">
        <aside className="w-52 shrink-0 border-r border-border py-10 pr-6 max-lg:hidden">
          <div className="sticky top-24">
            <DocsNav />
          </div>
        </aside>
        <main className="min-w-0 flex-1 py-10 lg:py-12">
          <Outlet />
        </main>
      </div>
      <SiteFooter />
    </>
  );
}
