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
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { StoreReviewBadge } from "@/components/store-review-badge";
import { Output, Prompt, Terminal } from "@/components/terminal";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
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
        <section className="py-20 sm:py-28">
          <div className="mx-auto grid max-w-6xl items-center gap-16 px-4 sm:px-6 lg:grid-cols-2 lg:gap-12 lg:px-8">
            <div>
              <h1 className="max-w-[20ch] font-display text-5xl font-semibold tracking-tight text-balance sm:text-6xl">
                Take the reins of your real browser
              </h1>
              <p className="mt-6 max-w-[48ch] text-lg text-pretty text-muted-foreground">
                reins lets coding agents (Claude Code, Cursor, Codex, anything with a shell) drive
                the logged-in browser you already use. No debug profile, no launch flags, no MCP
                server to register.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-4">
                <Button asChild size="lg">
                  <Link to="/docs">Get started</Link>
                </Button>
                <Button asChild size="lg" variant="ghost">
                  <a href="https://github.com/karnstack/reins" target="_blank" rel="noreferrer">
                    View on GitHub
                  </a>
                </Button>
              </div>
              <CopyCommand command="npm i -g @karnstack/reins" className="mt-8 max-w-md" />
            </div>
            <Terminal title="agent session">
              <Prompt>reins tabs</Prompt>
              <Output>{"  b1  chrome  tab 12 *  Dashboard — localhost:3000"}</Output>
              <Prompt>reins snapshot</Prompt>
              <Output>{'  e3: input "Email"\n  e7: button "Sign in"'}</Output>
              <Prompt>reins type --ref e3 --text "you@work.dev"</Prompt>
              <Prompt>reins click --ref e7</Prompt>
              <Prompt>reins screenshot</Prompt>
              <Output>{"  ~/.reins/shots/tab-12.png"}</Output>
            </Terminal>
          </div>
        </section>

        <section className="py-20 sm:py-24">
          <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
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
            {/* biome-ignore lint/a11y/noRedundantRoles: Safari drops list semantics once list-style is none */}
            <ol role="list" className="mt-12 grid gap-x-8 gap-y-10 md:grid-cols-3">
              <li>
                <p className="font-mono text-sm text-muted-foreground">01</p>
                <h3 className="mt-2 font-semibold">Install the CLI</h3>
                <p className="mt-2 text-base/7 text-pretty text-muted-foreground sm:text-sm/6">
                  The daemon ships inside and starts on demand; any command spawns it.
                </p>
                <CopyCommand command="npm i -g @karnstack/reins" className="mt-4" />
              </li>
              <li>
                <p className="font-mono text-sm text-muted-foreground">02</p>
                <h3 className="mt-2 font-semibold">Add the extension</h3>
                <div className="mt-2">
                  <StoreReviewBadge />
                </div>
                <p className="mt-2 text-base/7 text-pretty text-muted-foreground sm:text-sm/6">
                  Until the store listing lands, one command stages it for Load unpacked. It
                  discovers the daemon on its own and the toolbar icon turns green when connected.
                </p>
                <CopyCommand command="reins extension" className="mt-4" />
              </li>
              <li>
                <p className="font-mono text-sm text-muted-foreground">03</p>
                <h3 className="mt-2 font-semibold">Teach your agent</h3>
                <p className="mt-2 text-base/7 text-pretty text-muted-foreground sm:text-sm/6">
                  The skill teaches any coding agent the command loop. From here, the agent drives.
                </p>
                <CopyCommand command="npx skills add karnstack/reins" className="mt-4" />
              </li>
            </ol>
          </div>
        </section>

        <section className="py-20 sm:py-24">
          <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
            <h2 className="max-w-[35ch] text-4xl font-semibold tracking-tight text-balance">
              Everything an agent needs to work a page
            </h2>
            <p className="mt-4 max-w-[56ch] text-pretty text-muted-foreground">
              A small, curated command set covers the whole loop: look at the page, act on it,
              verify the result.
            </p>
            <dl className="mt-12 grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map((feature) => (
                <div key={feature.title}>
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
                </div>
              ))}
            </dl>
          </div>
        </section>

        <section className="py-20 sm:py-24">
          <div className="mx-auto grid max-w-6xl gap-x-12 gap-y-10 px-4 sm:px-6 lg:grid-cols-2 lg:px-8">
            <div>
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
            </div>
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
          </div>
        </section>

        <section className="py-20 sm:py-28">
          <div className="mx-auto max-w-6xl px-4 text-center sm:px-6 lg:px-8">
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
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
