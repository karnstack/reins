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
      <P>Four steps from nothing to your agent driving your logged-in browser.</P>

      <H2 id="install-the-cli">1. Install the CLI</H2>
      <Shell lines={[`$ ${INSTALL_COMMAND}`]} />
      <P>
        This installs <Code>reins</Code>. Its daemon starts on its own when you run any command, and{" "}
        <Code>reins kill</Code> stops it. Nothing to configure.
      </P>

      {/* Before the extension, not after it. The extension step sends the
          reader to the Chrome Web Store, and the ones who do not come back
          are exactly the ones running an agent that does not know the
          commands exist. */}
      <H2 id="teach-your-agent">2. Teach your agent</H2>
      <Shell lines={[`$ ${SKILL_COMMAND}`]} />
      <P>
        This teaches your agent the commands. Skip it and your agent will still say it cannot open a
        browser. No skill support? Point it at <Code>reins help</Code>.
      </P>

      <H2 id="add-the-extension">3. Add the extension</H2>
      <P>
        Add the <A href={CHROME_WEB_STORE_URL}>reins extension</A> to each Chromium browser you want
        agents to reach: Chrome, Brave, Edge, Arc, Dia. Its icon turns green once it finds the
        daemon. No store access? See <A href="/docs/sideload">Install without the store</A>.
      </P>

      <H2 id="check">4. Check</H2>
      <Shell
        lines={[
          "$ reins status   # daemon state, port, connected browsers",
          "$ reins tabs     # every tab across every connected browser",
          "$ reins doctor   # diagnostic checks when something looks off",
        ]}
      />

      <H2 id="the-loop">The loop agents use</H2>
      <P>Look, act, check.</P>
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
        Page commands act on the active tab unless you pass <Code>--tab &lt;id&gt;</Code>. Add{" "}
        <Code>--json</Code> for raw output.
      </P>
      <Arrow href="/docs/commands">Full command reference</Arrow>
      <Arrow href="/docs/architecture">How the pieces fit together</Arrow>
    </>
  );
}
