import { createFileRoute } from "@tanstack/react-router";
import { A, Arrow, Code, H1, H2, P, Ul } from "@/components/md";
import { seo } from "@/lib/seo";

export const Route = createFileRoute("/docs/security")({
  head: () => ({
    ...seo({
      title: "Security · reins",
      description:
        "The reins security model: localhost-only daemon, DNS-rebinding protection, extension-origin allowlisting, Chrome's native debug banner, and instant disconnect.",
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
        A tool that drives your logged-in browser has to be careful with it. reins keeps the attack
        surface small by having no cloud half at all: the pieces only ever talk to each other, on
        your machine.
      </P>

      <H2 id="network">Network surface</H2>
      <Ul>
        <li>
          Everything binds <Code>127.0.0.1</Code>. Neither the daemon nor the extension is reachable
          from the network.
        </li>
        <li>
          <Code>/rpc</Code> and the other daemon endpoints validate the <Code>Host</Code> header, so
          web pages cannot reach the daemon even through rebound DNS.
        </li>
        <li>
          The daemon accepts extension WebSocket connections only from exact allowlisted{" "}
          <Code>chrome-extension://&lt;id&gt;</Code> origins. The browser stamps that header itself,
          so pages and other extensions cannot forge it. Dev builds are added explicitly with{" "}
          <Code>reins allow &lt;id&gt;</Code>.
        </li>
      </Ul>

      <H2 id="visibility">Visibility and control</H2>
      <Ul>
        <li>
          Chrome shows its native "is being debugged" banner whenever the extension is attached to a
          tab, so you always know when an agent is acting.
        </li>
        <li>The toolbar popup's Disconnect toggle cuts the daemon connection at once.</li>
        <li>
          Nothing happens in the background: the extension only acts on explicit commands sent
          through the CLI on your machine.
        </li>
      </Ul>

      <H2 id="permissions">Per-site permissions</H2>
      <Ul>
        <li>
          Every host resolves to a tier: <Code>deny</Code>, <Code>read</Code> or <Code>full</Code>.
          The extension enforces it before any command touches a tab. The check runs inside the
          extension, so nothing that speaks the protocol can skip or loosen it. That includes the
          CLI, the daemon, and any other local client.
        </li>
        <li>
          Grants happen only in the extension popup. That is a user gesture, and an agent cannot
          perform it from the shell. The CLI (<Code>reins policy</Code>) can view and tighten the
          policy, never loosen it.
        </li>
        <li>
          The shipped default is <Code>full</Code> everywhere, which is today's behavior, so
          tightening is opt-in. <Code>deny</Code> also redacts the site's tabs from{" "}
          <Code>reins tabs</Code>.
        </li>
      </Ul>
      <Arrow href="/docs/permissions">Tiers, wildcard rules and matching precedence</Arrow>

      <H2 id="trust-boundary">Trust boundary</H2>
      <P>
        The tiers contain the agent you invited in. They are not a defense against other software on
        your machine. Anything already running as your OS user sits inside the trust boundary: it
        could talk to the daemon or rewrite the policy store directly, and no browser automation
        tool's permission model survives local malware. The honest write-up covers what the tiers
        protect against, what they do not, prompt injection, and a hardening checklist. It is the{" "}
        <A href="https://github.com/karnstack/reins/blob/main/docs/SECURITY.md">
          threat model (SECURITY.md)
        </A>
        .
      </P>

      <H2 id="audit">Audit trail</H2>
      <Ul>
        <li>
          Every command the daemon executes, and every one the policy blocks, appends one structured
          line (timestamp, command, browser, tab, host, tier, outcome, duration) to{" "}
          <Code>~/.reins/logs/audit-YYYY-MM-DD.jsonl</Code>. <Code>reins audit</Code> renders the
          trail, and <Code>--denied</Code> shows only what policy blocked.
        </li>
        <li>
          Value-bearing params are redacted before the line is written: typed text, fill values,{" "}
          <Code>eval</Code> code and CDP payloads. The trail never stores what the agent typed, only
          that it typed.
        </li>
        <li>
          Audit files are pruned after 30 days. Writes are best-effort: a full disk never blocks a
          command.
        </li>
      </Ul>

      <H2 id="reins-do">reins do and TypeSafe</H2>
      <P>
        <Code>reins do</Code> is off until you save a TypeSafe API key (
        <Code>reins key set typesafe</Code>, or the Jev section of the extension popup). Once a key
        is saved, and only while a <Code>reins do</Code> run is working, the daemon (not the
        extension) sends this to <Code>api.typesafe.ai</Code>, under your own TypeSafe account:
      </P>
      <Ul>
        <li>
          the goal you gave, and your <Code>--fill</Code> names and values
        </li>
        <li>the tab's URL and title</li>
        <li>visible text in the viewport (up to about 6,000 characters)</li>
        <li>labels, roles and current values of the page's interactive elements</li>
        <li>the run's last 10 actions</li>
      </Ul>
      <P>
        Never sent: password, file and hidden inputs. The extension itself makes no remote requests.
      </P>
      <P>
        Before every click or keystroke, reins re-checks the chosen element (still present, visible,
        not covered, not moving) and refuses to act when the check fails. The page still controls
        its own DOM, so what sits under a chosen element can change between the check and the
        action; keep <Code>--confirm</Code> for anything you would not click blind.
      </P>
      <P>
        <Code>reins do</Code> hands page state to TypeSafe's Jev model, which answers typed
        multiple-choice questions: which operation, and which observed element. Jev can only choose
        among elements reins actually read from the page; its output never becomes a selector,
        coordinate or code. Page text can still try to steer it (prompt injection), so:
      </P>
      <Ul>
        <li>
          A click whose label contains a money, messaging or deletion word (buy, pay, send, delete,
          …) stops the run unless the agent passed <Code>--confirm</Code> for that label or the goal
          names it word for word. Unlabeled buttons stop too. This is a heuristic, not a guarantee:
          other languages and odd labels can slip past.
        </li>
        <li>
          A run that moves to another site stops (<Code>left_site</Code>), and site permissions
          still apply on every step (<Code>full</Code> required).
        </li>
        <li>
          Ctrl-C, a dead agent, <Code>--timeout</Code> or a daemon restart stop the run before its
          next action.
        </li>
        <li>
          The key file is <Code>~/.reins/credentials.json</Code> (0600). The key is never returned
          by any command, never logged, and never sent to a page.
        </li>
      </Ul>

      <H2 id="data">Data handling</H2>
      <Ul>
        <li>
          Page content and tab metadata are read through the Chrome DevTools Protocol only when your
          local daemon asks, and are sent only to that daemon over localhost.
        </li>
        <li>
          No analytics, no telemetry, no tracking, no remote code. No remote servers unless you opt
          in to <Code>reins do</Code> with a TypeSafe key (see <A href="#reins-do">above</A>).
        </li>
        <li>
          The only stored state is the extension's own settings (auto-connect, cached daemon port,
          connection status) and your site-permission policy, kept in <Code>chrome.storage</Code> on
          your device.
        </li>
      </Ul>
      <P>
        The full policy is at <A href="/privacy">reins.tech/privacy</A>. The code is MIT-licensed
        and auditable at <A href="https://github.com/karnstack/reins">github.com/karnstack/reins</A>
        .
      </P>
    </>
  );
}
