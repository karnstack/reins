import { A, Column, Rule, TEXT } from "@/components/md";
import { NPM_URL, REPO_URL, X_URL } from "@/lib/site";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/docs", label: "Docs" },
  { href: "/docs/commands", label: "Commands" },
  { href: "/docs/permissions", label: "Site permissions" },
  { href: "/docs/security", label: "Security" },
  { href: "/changelog", label: "Changelog" },
  { href: "/privacy", label: "Privacy" },
  { href: REPO_URL, label: "GitHub" },
  { href: NPM_URL, label: "npm" },
];

export function SiteFooter() {
  return (
    <footer data-pagefind-ignore>
      <Column className="pb-16">
        <Rule />
        <p className={cn(TEXT, "mt-5 flex flex-wrap gap-x-2")}>
          {LINKS.map((link, i) => (
            <span key={link.href}>
              {i > 0 && (
                <span aria-hidden="true" className="mr-2 text-muted-foreground">
                  |
                </span>
              )}
              <A href={link.href}>{link.label}</A>
            </span>
          ))}
        </p>
        <p className={cn(TEXT, "mt-5 text-muted-foreground")}>
          &copy; 2026 karnstack. MIT. Made by <A href={X_URL}>karn</A> and a few AI agents.
        </p>
      </Column>
    </footer>
  );
}
