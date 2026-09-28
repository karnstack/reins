import { createFileRoute } from "@tanstack/react-router";
import { A, Arrow, Code, H1, H2, P, Ul } from "@/components/md";
import { seo } from "@/lib/seo";

export const Route = createFileRoute("/docs/security")({
  head: () => ({
    ...seo({
      title: "Security · reins",
      description:
        "The reins security model: localhost-only daemon, extension-origin allowlisting, per-site permissions, a redacted audit trail, and exactly what reins do sends to TypeSafe.",
      path: "/docs/security",
    }),
  }),
  component: SecurityPage,
});

function SecurityPage() {
  return (
    <>
      <H1>Security</H1>
      <P>
        reins has no cloud half. The CLI, the daemon and the extension only talk to each other, on
        your machine.
      </P>

      <H2 id="network">Network</H2>
      <Ul>
        <li>
          Everything binds <Code>127.0.0.1</Code>. Nothing is reachable from the network.
        </li>
        <li>
          The daemon checks the <Code>Host</Code> header, so a web page cannot reach it through DNS
          rebinding.
        </li>
        <li>
          It accepts only allowlisted <Code>chrome-extension://&lt;id&gt;</Code> origins. Chrome
          sets that header itself, so pages and other extensions cannot fake it.
        </li>
      </Ul>

      <H2 id="visibility">Seeing and stopping it</H2>
      <Ul>
        <li>Chrome shows its "is being debugged" banner on any tab reins is attached to.</li>
        <li>Disconnect in the toolbar popup cuts the connection at once.</li>
        <li>The extension acts only on commands from the CLI. Nothing runs in the background.</li>
      </Ul>

      <H2 id="permissions">Site permissions</H2>
      <P>
        Every site is <Code>deny</Code>, <Code>read</Code> or <Code>full</Code>, checked inside the
        extension before any command runs. Only a click in the popup can grant more; the CLI can
        only tighten. The default is <Code>full</Code> everywhere, so this is opt-in.
      </P>
      <Arrow href="/docs/permissions">How site permissions work</Arrow>

      <H2 id="trust-boundary">What it does not protect against</H2>
      <P>
        The tiers contain the agent you invited in. They do not stop other software running as you,
        which could talk to the daemon or edit the policy directly. The{" "}
        <A href="https://github.com/karnstack/reins/blob/main/docs/SECURITY.md">threat model</A>{" "}
        covers this, prompt injection, and a hardening checklist.
      </P>

      <H2 id="audit">Audit trail</H2>
      <P>
        Every command, and every one policy blocks, adds a line to{" "}
        <Code>~/.reins/logs/audit-YYYY-MM-DD.jsonl</Code>. Typed text, fill values, eval code and
        CDP payloads are redacted, so the log shows that the agent typed, never what. Files are
        deleted after 30 days. <Code>reins audit</Code> shows the trail; <Code>--denied</Code> shows
        only blocks.
      </P>

      <H2 id="reins-do">reins do and TypeSafe</H2>
      <P>
        <Code>reins do</Code> is off until you save a TypeSafe key (
        <Code>reins key set typesafe</Code>). While a run is working, the daemon sends this to{" "}
        <Code>api.typesafe.ai</Code>, under your account:
      </P>
      <Ul>
        <li>
          your goal and your <Code>--fill</Code> values
        </li>
        <li>the tab's URL and title</li>
        <li>visible text, up to about 6,000 characters</li>
        <li>labels and values of the page's controls</li>
        <li>the run's last 10 actions</li>
      </Ul>
      <P>
        Password, file and hidden inputs are never sent. The key lives in{" "}
        <Code>~/.reins/credentials.json</Code> (mode 0600) and is never printed, logged or sent to a
        page.
      </P>
      <P>
        Jev can only pick from elements reins read off the page. To limit what a page can talk it
        into:
      </P>
      <Ul>
        <li>
          Clicks labelled with words like buy, pay, send or delete stop the run unless you pass{" "}
          <Code>--confirm</Code> or the goal names that label. Unlabelled buttons stop too. It
          matches English words, so it is not a guarantee.
        </li>
        <li>
          Leaving the site stops the run (<Code>left_site</Code>). Site permissions apply on every
          step.
        </li>
        <li>
          Ctrl-C, <Code>--timeout</Code> or a daemon restart stops it before the next action.
        </li>
        <li>
          reins re-checks each element right before acting, but a page can still swap what sits
          under it. Use <Code>--confirm</Code> for anything you would not click blind.
        </li>
      </Ul>

      <H2 id="data">Data</H2>
      <P>
        No analytics, no telemetry, no remote code. Page content goes only to your local daemon,
        unless you opt in to <Code>reins do</Code>. The extension stores its settings and your site
        policy in <Code>chrome.storage</Code>. Full policy:{" "}
        <A href="/privacy">reins.tech/privacy</A>. Source:{" "}
        <A href="https://github.com/karnstack/reins">github.com/karnstack/reins</A>.
      </P>
    </>
  );
}
