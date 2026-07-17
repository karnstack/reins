import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { GitHubIcon, NpmIcon, XIcon } from "@/components/icons";
import { Wordmark } from "@/components/logo";
import { GITHUB_URL, NPM_URL, REPO_URL, X_URL } from "@/lib/site";

const COLUMNS: Array<{
  title: string;
  links: Array<{ label: string; to: string; external?: boolean }>;
}> = [
  {
    title: "Product",
    links: [
      { label: "Overview", to: "/" },
      { label: "Get started", to: "/docs" },
      { label: "Changelog", to: "/changelog" },
    ],
  },
  {
    title: "Docs",
    links: [
      { label: "Commands", to: "/docs/commands" },
      { label: "Site permissions", to: "/docs/permissions" },
      { label: "Architecture", to: "/docs/architecture" },
      { label: "FAQ", to: "/docs/faq" },
    ],
  },
  {
    title: "Project",
    links: [
      { label: "Security", to: "/docs/security" },
      { label: "Privacy", to: "/privacy" },
      { label: "GitHub", to: REPO_URL, external: true },
      { label: "npm", to: NPM_URL, external: true },
    ],
  },
];

function FooterLink({
  to,
  external,
  children,
}: {
  to: string;
  external?: boolean;
  children: ReactNode;
}) {
  const className = "text-sm font-normal text-muted-foreground hover:text-foreground";
  if (external) {
    return (
      <a href={to} target="_blank" rel="noreferrer" className={className}>
        {children}
      </a>
    );
  }
  return (
    <Link to={to} className={className}>
      {children}
    </Link>
  );
}

function SocialLink({
  href,
  label,
  children,
}: {
  href: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      aria-label={label}
      className="relative inline-flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
    >
      {children}
      <span
        className="absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-1/2 pointer-fine:hidden"
        aria-hidden="true"
      />
    </a>
  );
}

export function SiteFooter() {
  return (
    <footer data-pagefind-ignore className="overflow-hidden border-t border-border">
      <div className="mx-auto max-w-6xl px-4 pt-14 pb-8 sm:px-6 lg:px-8">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-[1.6fr_1fr_1fr_1fr]">
          <div className="max-w-xs">
            <a href="/" aria-label="Homepage">
              <Wordmark />
            </a>
            <p className="mt-4 text-sm text-pretty text-muted-foreground">
              Drive the logged-in browser you already use, straight from your coding agent.
            </p>
            <div className="mt-5 -ml-2 flex items-center gap-1">
              <SocialLink href={X_URL} label="Karn on X">
                <XIcon className="size-4" />
              </SocialLink>
              <SocialLink href={GITHUB_URL} label="Karn on GitHub">
                <GitHubIcon className="size-4" />
              </SocialLink>
              <SocialLink href={NPM_URL} label="reins on npm">
                <NpmIcon className="size-4" />
              </SocialLink>
            </div>
          </div>

          {COLUMNS.map((col) => (
            <div key={col.title}>
              <p className="text-sm font-medium text-foreground">{col.title}</p>
              {/* biome-ignore lint/a11y/noRedundantRoles: Tailwind Preflight sets list-style:none, which drops the implicit list role in Safari VoiceOver */}
              <ul role="list" className="mt-3 space-y-2.5">
                {col.links.map((link) => (
                  <li key={link.label}>
                    <FooterLink to={link.to} external={link.external}>
                      {link.label}
                    </FooterLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Oversized wordmark watermark — the footer's signature. */}
        <div aria-hidden="true" className="mt-12 select-none">
          <p className="font-display text-[clamp(3.5rem,18vw,11rem)] leading-none font-semibold tracking-tight text-foreground/[0.05]">
            reins
          </p>
        </div>

        <div className="mt-6 flex flex-col gap-3 border-t border-border pt-6 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>
            © 2026 reins · Built by{" "}
            <a
              href={X_URL}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-foreground hover:underline"
            >
              Karn
            </a>{" "}
            and AI agents.
          </p>
          <p>MIT licensed · open source.</p>
        </div>
      </div>
    </footer>
  );
}
