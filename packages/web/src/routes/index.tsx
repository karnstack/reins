import { createFileRoute } from "@tanstack/react-router";
import { BrowserMock } from "@/components/browser-mock";
import { CopyCommand } from "@/components/copy-command";
import {
  A,
  Arrow,
  Code,
  Column,
  H2,
  Kbd,
  Meta,
  Ol,
  P,
  Pre,
  Shell,
  Table,
  TEXT,
  Ul,
} from "@/components/md";
import { PopupMock } from "@/components/popup-mock";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { seo } from "@/lib/seo";
import { CHROME_WEB_STORE_URL, INSTALL_COMMAND, REPO_URL, SKILL_COMMAND } from "@/lib/site";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  head: () => ({
    ...seo({
      title: "reins: drive your real browser from your coding agent",
      description:
        "reins is a CLI that hands your coding agent the logged-in Chromium browser you already use. A local daemon and a Manifest V3 extension, everything on 127.0.0.1. No cloud, no telemetry, MIT.",
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
  component: Home,
});

/**
 * One document, top to bottom.
 *
 * What it is, what it does, the loop, how it reaches a tab, who is allowed to
 * touch what, the facts, the limits, the install line. No hero, no cards, no
 * numbered boxes. The two mocks are the only pictures, and they sit in the
 * flow where a README would put a screenshot.
 */
function Home() {
  return (
    <>
      <SiteHeader />
      <main>
        <Column className="py-10">
          <Meta lines={["karnstack", "reins", "2026 · MIT"]} />

          <JevCallout />

          <div className="mt-12">
            <h1 className={cn(TEXT, "font-semibold tracking-wide text-balance uppercase")}>
              <span aria-hidden="true" className="mr-2 text-muted-foreground select-none">
                #
              </span>
              Drive the browser you are already signed in to
            </h1>
          </div>
          <P>
            reins is a CLI that hands your coding agent the real Chromium browser you already use.
            Claude Code, Cursor, Codex, anything with a shell. The logins, the cookies and the
            sessions are already there, because it is your browser. No debug profile, no launch
            flags, no MCP server to register.
          </P>

          <Install />

          <BrowserMock className="mt-10" />

          <WhatItDoes />
          <Loop />
          <HowItWorks />
          <Permissions />
          <Facts />
          <Limits />
          <More />
        </Column>
      </main>
      <SiteFooter />
    </>
  );
}

/**
 * The one piece of news on the page: a line, not a banner. Bracketed like the
 * header's links; the figures are the benchmark's medians, linked to it.
 */
function JevCallout() {
  return (
    <p className={cn(TEXT, "mt-10 max-w-[68ch] border-l-2 border-primary pl-4")}>
      <span className="mr-2 font-semibold tracking-wide text-primary uppercase">[ new ]</span>
      <Code>reins do</Code> hands a whole browsing task to Jev, TypeSafe's action model: one command
      instead of a click-by-click session. On our benchmark it was 4.6x faster at the median and
      about 100x cheaper. <A href="/docs/commands#delegate">How it works</A> ·{" "}
      <A href="/docs/benchmarks">the benchmark</A>
    </p>
  );
}

/* ------------------------------------------------------------------------ */

function WhatItDoes() {
  return (
    <>
      <H2 id="what-it-does">What it does</H2>
      <Ul>
        <li>Tabs in every connected browser: list, open, focus, close.</li>
        <li>Click, type, fill, select, hover, scroll, press keys, upload files, answer dialogs.</li>
        <li>
          <Code>reins snapshot</Code> lists what you can click, with short refs to act on. CSS
          selectors work too.
        </li>
        <li>Read the page as text or a screenshot.</li>
        <li>Console messages and network requests, without opening DevTools.</li>
        <li>
          <Code>reins eval</Code> for JavaScript, <Code>reins cdp</Code> for any raw DevTools
          Protocol call.
        </li>
        <li>
          <Code>reins do</Code> hands a whole task to Jev, TypeSafe's action model, instead of going
          click by click.
        </li>
      </Ul>
    </>
  );
}

/* ------------------------------------------------------------------------ */

const LOOP_LINES = [
  "$ reins snapshot",
  '  e3: input "Email"',
  '  e7: button "Sign in"',
  '$ reins type --ref e3 --text "you@work.dev"',
  "$ reins click --ref e7",
  "$ reins text",
  "  Signed in as you@work.dev",
];

function Loop() {
  return (
    <>
      <H2 id="loop">The loop</H2>
      <P>Look, act, check.</P>
      <Shell lines={LOOP_LINES} />
      <Arrow href="/docs/commands">Full command reference</Arrow>
    </>
  );
}

/* ------------------------------------------------------------------------ */

/*
 * The whole path from a shell to a tab, drawn as one line. Nothing on it
 * leaves the machine, which is the thing worth showing.
 */
const PATH = `your agent            your machine                  your browser
shells out            daemon, starts on demand      extension, MV3
reins <cmd>  ───────► 127.0.0.1  ──────────────────► chrome.debugger, CDP`;

const PATH_LABEL =
  "Your agent shells out to the reins CLI. The CLI talks to a daemon on 127.0.0.1, which starts on demand. The daemon holds a WebSocket to a Manifest V3 extension, which acts on your tabs through the Chrome DevTools Protocol.";

function HowItWorks() {
  return (
    <>
      <H2 id="how-it-works">How it works</H2>
      <P>
        Three pieces, all on your machine. The daemon ships inside the CLI and starts on its own.
        Chrome shows its "is being debugged" banner while reins is attached to a tab.
      </P>
      <Pre label={PATH_LABEL}>{PATH}</Pre>
      <Arrow href="/docs/architecture">How the three pieces fit together</Arrow>
    </>
  );
}

/* ------------------------------------------------------------------------ */

function Permissions() {
  return (
    <>
      <H2 id="permissions">Site permissions</H2>
      <P>
        Every site gets one of three tiers, checked inside the extension where an agent cannot skip
        it.
      </P>
      <Table
        rows={[
          ["deny", "Nothing. Commands fail, and the site's tabs are redacted from reins tabs."],
          [
            "read",
            "Reading only. snapshot, text, screenshot, console, network and wait. Anything that acts on the page is blocked.",
          ],
          ["full", "Everything, including navigation, interaction, eval and raw CDP."],
        ]}
      />
      <P>
        Only a click in the extension popup grants more access. From the shell,{" "}
        <Code>reins policy</Code> can tighten, never loosen.
      </P>
      <PopupMock className="mt-10 font-sans" />
      <Arrow href="/docs/permissions">How site permissions work</Arrow>
    </>
  );
}

/* ------------------------------------------------------------------------ */

function Facts() {
  return (
    <>
      <H2 id="facts">Facts</H2>
      <Table
        rows={[
          ["License", "MIT"],
          ["Browsers", "Chrome, Brave, Edge, Arc, Dia. Any Chromium that takes MV3 extensions."],
          ["Agents", "Claude Code, Cursor, Codex, Copilot, Gemini CLI. Anything with a shell."],
          [
            "Network",
            <>
              Binds <Code>127.0.0.1</Code>. No account, no hosted service, no telemetry.
            </>,
          ],
        ]}
      />
    </>
  );
}

/* ------------------------------------------------------------------------ */

function Limits() {
  return (
    <>
      <H2 id="limits">Limits</H2>
      <Table
        rows={[
          ["Browsers", "Chromium only. No Firefox, no WebKit."],
          ["Headless", "Not supported. reins drives a browser you already have open."],
          ["CI", "Not the target. Use Playwright or agent-browser there."],
          ["Releases", "0.x. Commands, flags and output can still change."],
        ]}
      />
    </>
  );
}

/* ------------------------------------------------------------------------ */

/**
 * Install, at the top, where the reader still is.
 *
 * It used to close the page, under the facts and the limits, and the skill
 * was the last line of it. People installed the CLI, installed the
 * extension, and stopped: two visible halves that plainly do something, and
 * a third step below the fold that reads like an optional extra. It is not.
 * Without the skill the agent has the CLI on its PATH and no idea the
 * commands exist.
 *
 * So the skill is step two, between the two shell one-liners, rather than
 * step three on the far side of a trip to the Chrome Web Store. The order of
 * the three does not matter to the software. It matters to whether anyone
 * finishes.
 */
function Install() {
  return (
    <>
      <H2 id="install">Install</H2>
      <P>Three steps. Do not skip the second: without it your agent never learns the commands.</P>
      <Ol>
        <li>
          The CLI. The daemon rides inside it and starts on demand.
          <CopyCommand command={INSTALL_COMMAND} className={cn(TEXT, "mt-3 max-w-[60ch]")} />
        </li>
        <li>
          The skill, so your agent knows the commands. No skill support? It can read{" "}
          <Code>reins help</Code>.
          <CopyCommand command={SKILL_COMMAND} className={cn(TEXT, "mt-3 max-w-[60ch]")} />
        </li>
        <li>
          The extension, in each browser you want agents to reach. Its icon turns green once
          connected.
          <p className={cn(TEXT, "mt-3")}>
            <A href={CHROME_WEB_STORE_URL}>Add reins from the Chrome Web Store</A>
          </p>
        </li>
      </Ol>
      <P>
        Then <Code>reins status</Code> shows what is connected.
      </P>
    </>
  );
}

/* ------------------------------------------------------------------------ */

function More() {
  return (
    <>
      <H2 id="more">More</H2>
      <P muted>
        No Chrome Web Store access? <Code>reins extension</Code> stages the bundled copy for
        Chrome's Load unpacked, with no <Code>reins allow</Code> step.
      </P>
      <P>
        Press <Kbd>&#8984;K</Kbd> anywhere on this site to search the docs.
      </P>
      <Arrow href="/docs">Setup guide</Arrow>
      <Arrow href={REPO_URL}>Source</Arrow>
    </>
  );
}
