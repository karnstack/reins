import { createFileRoute, Link } from "@tanstack/react-router";
import {
  AppWindow,
  Braces,
  Bug,
  KeyRound,
  MousePointerClick,
  ScanSearch,
  ShieldCheck,
} from "lucide-react";
import { CopyCommand } from "@/components/copy-command";
import { Hero } from "@/components/hero";
import { IdeasSection } from "@/components/ideas-section";
import { PopupMock } from "@/components/popup-mock";
import { Reveal } from "@/components/reveal";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { seo } from "@/lib/seo";

const CHROME_WEB_STORE_URL =
  "https://chromewebstore.google.com/detail/reins/hnjcfgochepemjndccfblpmfmlblkofo";

export const Route = createFileRoute("/")({
  head: () => ({
    ...seo({
      title: "reins: drive your real browser from your coding agent",
      description:
        "reins lets coding agents drive the logged-in Chromium browser you already use, through a local CLI, daemon, and extension. Everything stays on 127.0.0.1.",
      path: "/",
    }),
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "SoftwareApplication",
          name: "reins",
          applicationCategory: "DeveloperApplication",
          operatingSystem: "macOS, Linux, Windows",
          description:
            "reins lets coding agents drive the logged-in Chromium browser you already use, through a local CLI, daemon, and extension.",
          url: "https://reins.tech",
          offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
          license: "https://github.com/karnstack/reins/blob/main/LICENSE",
          sameAs: [
            "https://github.com/karnstack/reins",
            "https://www.npmjs.com/package/@karnstack/reins",
          ],
        }),
      },
    ],
  }),
  component: LandingPage,
});

const FEATURES = [
  {
    icon: AppWindow,
    title: "Every tab, every browser",
    description:
      "List, open, focus, and close tabs across Chrome, Brave, Edge, Arc, and Dia. One daemon serves every connected browser.",
  },
  {
    icon: MousePointerClick,
    title: "Real interaction",
    description:
      "Click, type, fill, select, hover, scroll, press keys, and upload files, all addressed by stable element refs, not brittle selectors.",
  },
  {
    icon: ScanSearch,
    title: "See the page",
    description:
      "Snapshot interactive elements, read visible text, and capture screenshots your agent can open and reason about.",
  },
  {
    icon: Bug,
    title: "Debug signals",
    description:
      "Read a tab's recent console messages and network requests without ever opening DevTools.",
  },
  {
    icon: Braces,
    title: "An escape hatch",
    description:
      "Evaluate JavaScript in the page, or issue raw Chrome DevTools Protocol commands when the curated set isn't enough.",
  },
  {
    icon: KeyRound,
    title: "Your sessions intact",
    description:
      "It is your real profile, with logins, cookies, and state included. No separate automation browser to babysit.",
  },
];

function SectionDivider() {
  return (
    <div
      aria-hidden="true"
      className="mx-auto h-px max-w-6xl bg-gradient-to-r from-transparent via-border to-transparent"
    />
  );
}

const SECURITY_POINTS = [
  "Everything binds 127.0.0.1; nothing is reachable from the network.",
  "Host-header validation blocks DNS rebinding, so web pages can't reach the daemon.",
  "Only allowlisted chrome-extension:// origins may connect, an identity pages can't forge.",
  "Chrome shows its native debugging banner whenever the extension is attached.",
  "The popup's Disconnect toggle severs the connection instantly.",
];

function LandingPage() {
  return (
    <>
      <SiteHeader />
      <main>
        <Hero />

        <SectionDivider />

        <section className="py-20 sm:py-24">
          <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
            <Reveal>
              <p className="font-mono text-sm tracking-wide text-muted-foreground uppercase">
                How it works
              </p>
              <h2 className="mt-3 max-w-[35ch] text-4xl font-semibold tracking-tight text-balance">
                Install once, drive everything
              </h2>
              <p className="mt-4 max-w-[56ch] text-pretty text-muted-foreground">
                Three pieces, all yours: a CLI your agent calls, a daemon it auto-spawns, and an
                extension that dials in. Nothing to keep running, nothing to register per agent.
              </p>
            </Reveal>
            {/* biome-ignore lint/a11y/noRedundantRoles: Safari drops list semantics once list-style is none */}
            <ol role="list" className="mt-12 grid gap-x-8 gap-y-10 md:grid-cols-3">
              <li>
                <Reveal>
                  <p className="font-mono text-sm text-muted-foreground">01</p>
                  <h3 className="mt-2 font-semibold">Install the CLI</h3>
                  <p className="mt-2 text-base/7 text-pretty text-muted-foreground sm:text-sm/6">
                    The daemon ships inside and starts on demand; any command spawns it.
                  </p>
                  <CopyCommand command="npm i -g @karnstack/reins" className="mt-4" />
                </Reveal>
              </li>
              <li>
                <Reveal delay={100}>
                  <p className="font-mono text-sm text-muted-foreground">02</p>
                  <h3 className="mt-2 font-semibold">Add the extension</h3>
                  <p className="mt-2 text-base/7 text-pretty text-muted-foreground sm:text-sm/6">
                    Install it from the Chrome Web Store in every browser you want agents to reach.
                    It discovers the daemon on its own and the toolbar icon turns green when
                    connected.
                  </p>
                  <Button asChild variant="outline" className="mt-4">
                    <a href={CHROME_WEB_STORE_URL} target="_blank" rel="noreferrer">
                      Get the extension
                    </a>
                  </Button>
                </Reveal>
              </li>
              <li>
                <Reveal delay={200}>
                  <p className="font-mono text-sm text-muted-foreground">03</p>
                  <h3 className="mt-2 font-semibold">Teach your agent</h3>
                  <p className="mt-2 text-base/7 text-pretty text-muted-foreground sm:text-sm/6">
                    The skill teaches any coding agent the command loop. From here, the agent
                    drives.
                  </p>
                  <CopyCommand command="npx skills add karnstack/reins" className="mt-4" />
                </Reveal>
              </li>
            </ol>
          </div>
        </section>

        <SectionDivider />

        <section className="py-20 sm:py-24">
          <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
            <Reveal>
              <h2 className="max-w-[35ch] text-4xl font-semibold tracking-tight text-balance">
                Everything an agent needs to work a page
              </h2>
              <p className="mt-4 max-w-[56ch] text-pretty text-muted-foreground">
                A small, curated command set covers the whole loop: look at the page, act on it,
                verify the result.
              </p>
            </Reveal>
            <dl className="mt-12 grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map((feature, i) => (
                <Reveal key={feature.title} delay={(i % 3) * 100}>
                  <dt className="flex items-center gap-3 font-semibold">
                    <feature.icon
                      aria-hidden="true"
                      className="size-5 shrink-0 text-violet-600 dark:text-violet-400"
                    />
                    {feature.title}
                  </dt>
                  <dd className="mt-2 text-base/7 text-pretty text-muted-foreground sm:text-sm/6">
                    {feature.description}
                  </dd>
                </Reveal>
              ))}
            </dl>
          </div>
        </section>

        <SectionDivider />

        <IdeasSection />

        <SectionDivider />

        <section className="py-20 sm:py-24">
          <div className="mx-auto grid max-w-6xl items-center gap-x-12 gap-y-12 px-4 sm:px-6 lg:grid-cols-2 lg:px-8">
            <Reveal>
              <p className="font-mono text-sm tracking-wide text-muted-foreground uppercase">
                Trust
              </p>
              <h2 className="mt-3 max-w-[35ch] text-4xl font-semibold tracking-tight text-balance">
                You hold the reins
              </h2>
              <p className="mt-4 max-w-[56ch] text-pretty text-muted-foreground">
                Every site your agent touches resolves to a permission tier — deny, read-only, or
                full. The check runs inside the extension, the one place no process on your machine
                can reach around, so even a misbehaving agent can't skip it.
              </p>
              <p className="mt-4 max-w-[56ch] text-pretty text-muted-foreground">
                Granting more access takes a click in the extension popup — a user gesture no agent
                can fake from a shell. The CLI can inspect and tighten the policy, never loosen it.
              </p>
              <p className="mt-4 text-sm">
                <Link
                  to="/docs/permissions"
                  className="font-medium text-foreground underline underline-offset-3 decoration-foreground/30 hover:decoration-foreground"
                >
                  How site permissions work
                </Link>
              </p>
            </Reveal>
            <Reveal delay={150} className="flex justify-center lg:justify-end">
              <PopupMock />
            </Reveal>
          </div>
        </section>

        <SectionDivider />

        <section className="py-20 sm:py-24">
          <div className="mx-auto grid max-w-6xl gap-x-12 gap-y-10 px-4 sm:px-6 lg:grid-cols-2 lg:px-8">
            <Reveal>
              <h2 className="max-w-[35ch] text-4xl font-semibold tracking-tight text-balance">
                Local by design
              </h2>
              <p className="mt-4 max-w-[56ch] text-pretty text-muted-foreground">
                reins has no cloud half. The extension talks to one thing, your own daemon on
                127.0.0.1, and collects nothing, for anyone. The whole stack is open source and
                auditable.
              </p>
              <p className="mt-4 text-sm">
                <Link
                  to="/docs/security"
                  className="font-medium text-foreground underline underline-offset-3 decoration-foreground/30 hover:decoration-foreground"
                >
                  Read the security model
                </Link>
              </p>
            </Reveal>
            <Reveal delay={100}>
              {/* biome-ignore lint/a11y/noRedundantRoles: Safari drops list semantics once list-style is none */}
              <ul role="list" className="space-y-4">
                {SECURITY_POINTS.map((point) => (
                  <li key={point} className="flex items-start gap-3">
                    <ShieldCheck
                      aria-hidden="true"
                      className="size-5 shrink-0 text-violet-600 dark:text-violet-400"
                    />
                    <p className="text-base/6 text-pretty text-muted-foreground sm:text-sm/5">
                      {point}
                    </p>
                  </li>
                ))}
              </ul>
            </Reveal>
          </div>
        </section>

        <SectionDivider />

        <section className="relative isolate overflow-hidden py-20 sm:py-28">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 -z-10 [background:radial-gradient(42rem_26rem_at_50%_120%,--alpha(var(--color-primary)/12%),transparent_60%)] dark:[background:radial-gradient(42rem_26rem_at_50%_120%,--alpha(var(--color-primary)/20%),transparent_62%)]"
          />
          <div className="mx-auto max-w-6xl px-4 text-center sm:px-6 lg:px-8">
            <Reveal>
              <h2 className="mx-auto max-w-[30ch] font-display text-5xl font-semibold tracking-tight text-balance">
                Hand your agent the reins
              </h2>
              <p className="mx-auto mt-4 max-w-[48ch] text-pretty text-muted-foreground">
                Two installs and a skill: your agent is driving your browser in under a minute.
              </p>
              <div className="mt-8 flex justify-center">
                <CopyCommand command="npm i -g @karnstack/reins" />
              </div>
              <div className="mt-6">
                <Button asChild variant="outline" size="lg">
                  <Link to="/docs">Read the docs</Link>
                </Button>
              </div>
            </Reveal>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
