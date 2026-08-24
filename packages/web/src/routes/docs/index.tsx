import { createFileRoute } from "@tanstack/react-router";
import { A, Arrow, Code, H1, H2, P, Shell } from "@/components/md";
import { seo } from "@/lib/seo";
import { CHROME_WEB_STORE_URL, INSTALL_COMMAND, SKILL_COMMAND } from "@/lib/site";

export const Route = createFileRoute("/docs/")({
  head: () => ({
    ...seo({
      title: "Getting started · reins",
      description:
        "Install the reins CLI and Chrome extension, teach your coding agent the command loop, and have it driving your real logged-in browser in minutes.",
      path: "/docs",
    }),
  }),
  component: GettingStarted,
});

function GettingStarted() {
  return (
    <>
      <H1>Getting started</H1>
      <P>
        reins gives coding agents full control of your actual, logged-in Chromium browser, through a
        CLI and a Manifest V3 extension. Claude Code, Cursor, Codex, Copilot, anything with a shell.
        This page takes you from nothing to an agent driving a tab.
      </P>

      <H2 id="install-the-cli">1. Install the CLI</H2>
      <Shell lines={[`$ ${INSTALL_COMMAND}`]} />
      <P>
        This installs the <Code>reins</Code> command and the daemon it manages. You never run the
        daemon yourself: any command starts it on demand, it binds <Code>127.0.0.1</Code>, and{" "}
        <Code>reins kill</Code> stops it. There is nothing to configure and nothing to keep running.
      </P>

      {/* Before the extension, not after it. The extension step sends the
          reader to the Chrome Web Store, and the ones who do not come back
          are exactly the ones running an agent that does not know the
          commands exist. */}
      <H2 id="teach-your-agent">2. Teach your agent</H2>
      <Shell lines={[`$ ${SKILL_COMMAND}`]} />
      <P>
        The skill teaches agents the command set and the loop below. This is the step people skip,
        and skipping it is why an agent with reins installed still says it cannot open a browser.
        Agents without skill support can run <Code>reins help</Code>; the CLI is self-describing.
      </P>

      <H2 id="add-the-extension">3. Add the extension</H2>
      <P>
        Install the <A href={CHROME_WEB_STORE_URL}>reins extension from the Chrome Web Store</A> in
        every Chromium browser you want agents to reach. Chrome, Brave, Edge, Arc and Dia all work.
        The extension finds the daemon on its own through localhost port discovery, and the toolbar
        popover turns green when it is connected.
      </P>
      <P>
        Prefer to skip the store? <Code>reins extension</Code> stages the bundled copy for Chrome's
        Load unpacked. The walkthrough is on <A href="/docs/sideload">Install without the store</A>.
      </P>
      <P>Working from a dev build instead? Load the unpacked extension and allow its ID once:</P>
      <Shell lines={["$ reins allow <extension-id>"]} />

      <H2 id="check">4. Check</H2>
      <Shell
        lines={[
          "$ reins status   # daemon state, port, connected browsers",
          "$ reins tabs     # every tab across every connected browser",
          "$ reins doctor   # diagnostic checks when something looks off",
        ]}
      />

      <H2 id="the-loop">The loop agents use</H2>
      <P>Every page interaction is the same three beats: look, act, check.</P>
      <Shell
        lines={[
          "$ reins snapshot",
          '  e3: input "Email"',
          '  e7: button "Sign in"',
          '$ reins type --ref e3 --text "you@work.dev"',
          "$ reins click --ref e7",
          "$ reins text",
        ]}
      />
      <P>
        The commands that act on a page or a tab share three flags: <Code>--tab &lt;id&gt;</Code>{" "}
        (the active tab by default), <Code>--browser &lt;id&gt;</Code> (only needed when several
        browsers are connected) and <Code>--json</Code> for raw output.
      </P>
      <Arrow href="/docs/commands">Full command reference</Arrow>
      <Arrow href="/docs/architecture">How the pieces fit together</Arrow>
    </>
  );
}
