import { createFileRoute } from "@tanstack/react-router";
import { BrowserMock } from "@/components/browser-mock";
import { CopyCommand } from "@/components/copy-command";
import {
  Arrow,
  Code,
  Column,
  H2,
  Kbd,
  Meta,
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
import { INSTALL_COMMAND, REPO_URL } from "@/lib/site";
import { cn } from "@/lib/utils";

const CHROME_WEB_STORE_URL =
  "https://chromewebstore.google.com/detail/reins/hnjcfgochepemjndccfblpmfmlblkofo";

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

          <div className="mt-16">
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

          <CopyCommand command={INSTALL_COMMAND} className={cn(TEXT, "mt-5 max-w-[68ch]")} />
          <P muted>
            then add the{" "}
            <a
              href={CHROME_WEB_STORE_URL}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-4 hover:text-primary"
            >
              extension
            </a>{" "}
            in every browser you want agents to reach
          </P>

          <BrowserMock className="mt-10" />

          <WhatItDoes />
          <Loop />
          <HowItWorks />
          <Permissions />
          <Facts />
          <Limits />
          <Install />
        </Column>
      </main>
      <SiteFooter />
    </>
  );
}

/* ------------------------------------------------------------------------ */

function WhatItDoes() {
  return (
    <>
      <H2 id="what-it-does">What it does</H2>
      <Ul>
        <li>
          Every tab, every browser. List, open, focus and close tabs across Chrome, Brave, Edge, Arc
          and Dia. One daemon serves every browser that connects to it.
        </li>
        <li>
          Act on the page. Click, type, fill, select, hover, scroll, press keys, upload files,
          answer dialogs, resize the window.
        </li>
        <li>
          Refs, not selectors. <Code>reins snapshot</Code> lists the interactive elements with
          stable refs, and commands act by ref. A CSS <Code>--selector</Code> is there when you need
          it.
        </li>
        <li>Read the page. Visible text, and screenshots your agent can open and reason about.</li>
        <li>
          Console and network, without opening DevTools. Recent messages and requests, filtered by
          level, age or URL.
        </li>
        <li>
          An escape hatch. <Code>reins eval</Code> runs JavaScript in the page.{" "}
          <Code>reins cdp</Code> sends a raw Chrome DevTools Protocol command when the curated set
          is not enough.
        </li>
        <li>
          Site permissions. Every host resolves to deny, read or full, and the extension enforces it
          before a command touches a tab.
        </li>
        <li>
          An audit trail. Every command the daemon runs, and every one the policy blocks, appends
          one line to <Code>~/.reins/logs</Code>, with the values redacted.
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
      <P>
        Every page interaction is the same three beats: look, act, check. The commands that act on a
        page or a tab share three flags: <Code>--tab &lt;id&gt;</Code> (the active tab by default),{" "}
        <Code>--browser &lt;id&gt;</Code> (only when more than one browser is connected) and{" "}
        <Code>--json</Code> for raw output.
      </P>
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
        Three pieces with one narrow contract between them, and all three run on your machine. The
        daemon ships inside the CLI and starts on demand, so there is nothing to keep running and
        nothing to register per agent.
      </P>
      <Pre label={PATH_LABEL}>{PATH}</Pre>
      <P>
        The extension finds the daemon by probing a small set of localhost ports, and authenticates
        by its <Code>chrome-extension://&lt;id&gt;</Code> origin, a header the browser stamps itself
        and a page cannot forge. Chrome shows its native debugging banner the whole time it is
        attached.
      </P>
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
        Every site your agent touches resolves to one of three tiers. The check lives in the
        extension, the one place no process on your machine can reach around, so a misbehaving agent
        cannot skip it.
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
        Granting more access takes a click in the extension popup. That is a user gesture, and an
        agent in your shell cannot perform one. From the CLI, <Code>reins policy</Code> can inspect
        the policy and tighten it. It can never loosen it.
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
          ["Install", <Code key="i">{INSTALL_COMMAND}</Code>],
          ["Browsers", "Chrome, Brave, Edge, Arc, Dia. Any Chromium that takes MV3 extensions."],
          ["Agents", "Claude Code, Cursor, Codex, Copilot, Gemini CLI. Anything with a shell."],
          ["Binds", <Code key="b">127.0.0.1</Code>],
          ["Hosted service", "None"],
          ["Account", "None"],
          ["Telemetry", "None. No analytics, no tracking, no remote code."],
          ["Version", "0.x. Commands and output can still change."],
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
          [
            "CI",
            "Not the target. Use Playwright or agent-browser for a machine with nobody at it.",
          ],
          [
            "Two browsers",
            <>
              Supported, but commands then need <Code>--browser &lt;id&gt;</Code>. reins never
              guesses which one you meant.
            </>,
          ],
          ["Releases", "0.x. Commands, flags and output can still change."],
        ]}
      />
    </>
  );
}

/* ------------------------------------------------------------------------ */

function Install() {
  return (
    <>
      <H2 id="install">Install</H2>
      <Shell
        lines={[`$ ${INSTALL_COMMAND}`, "$ npx skills add karnstack/reins", "$ reins status"]}
      />
      <P>
        The first line installs the CLI, and the daemon rides along inside it. The second teaches
        any agent with skill support the command set; the rest can read <Code>reins help</Code>.
        Then install the extension in every browser you want agents to reach, and{" "}
        <Code>reins status</Code> shows what is connected.
      </P>
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
