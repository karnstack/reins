import { createFileRoute, Link } from "@tanstack/react-router";
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
    <article className="prose max-w-[70ch]">
      <h1>Security</h1>
      <p>
        A tool that drives your logged-in browser deserves a paranoid design. reins keeps the attack
        surface small by having no cloud half at all: the pieces only ever talk to each other, on
        your machine.
      </p>

      <h2>Network surface</h2>
      <ul>
        <li>
          Everything binds <code>127.0.0.1</code>; neither the daemon nor the extension is reachable
          from the network.
        </li>
        <li>
          <code>/rpc</code> and the other daemon endpoints validate the <code>Host</code> header, so
          web pages can't reach the daemon even through rebound DNS.
        </li>
        <li>
          The daemon accepts extension WebSocket connections only from exact allowlisted{" "}
          <code>chrome-extension://&lt;id&gt;</code> origins. Browsers stamp that header themselves;
          pages and other extensions can't forge it. Dev builds are added explicitly with{" "}
          <code>reins allow &lt;id&gt;</code>.
        </li>
      </ul>

      <h2>Visibility and control</h2>
      <ul>
        <li>
          Chrome shows its native "is being debugged" banner whenever the extension is attached to a
          tab, so you always know when an agent is acting.
        </li>
        <li>The toolbar popup's Disconnect toggle severs the daemon connection instantly.</li>
        <li>
          Nothing happens in the background: the extension only acts on explicit commands sent
          through the CLI on your machine.
        </li>
      </ul>

      <h2>Per-site permissions</h2>
      <ul>
        <li>
          Every host resolves to a tier — <code>deny</code>, <code>read</code>, or <code>full</code>{" "}
          — and the extension enforces it before any command touches a tab. The check runs inside
          the extension, so nothing speaking the protocol — the CLI, the daemon, or any other local
          client — can skip or loosen it.
        </li>
        <li>
          Grants happen only in the extension popup, a user gesture an agent can't perform from the
          shell. The CLI (<code>reins policy</code>) can view and tighten the policy, never loosen
          it.
        </li>
        <li>
          The shipped default is <code>full</code> everywhere — today's behavior — so tightening is
          opt-in. <code>deny</code> also redacts the site's tabs from <code>reins tabs</code>.
        </li>
      </ul>
      <p>
        The full model — tiers, wildcard rules, matching precedence — is on the{" "}
        <Link to="/docs/permissions">Site permissions</Link> page.
      </p>

      <h2>Trust boundary</h2>
      <p>
        The tiers contain the agent you invited in; they are not a defense against other software on
        your machine. Anything already running as your OS user sits inside the trust boundary — it
        could talk to the daemon or rewrite the policy store directly, and no browser automation
        tool's permission model survives local malware. The honest write-up — what the tiers protect
        against, what they can't, prompt injection, and a hardening checklist — is the{" "}
        <a
          href="https://github.com/karnstack/reins/blob/main/docs/SECURITY.md"
          target="_blank"
          rel="noreferrer"
        >
          threat model (SECURITY.md)
        </a>
        .
      </p>

      <h2>Audit trail</h2>
      <ul>
        <li>
          Every command the daemon executes — and every one the policy blocks — appends one
          structured line (timestamp, command, browser, tab, host, tier, outcome, duration) to{" "}
          <code>~/.reins/logs/audit-YYYY-MM-DD.jsonl</code>. <code>reins audit</code> renders the
          trail; <code>--denied</code> shows only what policy blocked.
        </li>
        <li>
          Value-bearing params — typed text, fill values, <code>eval</code> code, CDP payloads — are
          redacted before the line is written, so the trail never stores what the agent typed, only
          that it typed.
        </li>
        <li>
          Audit files are pruned after 30 days. Writes are best-effort: a full disk never blocks a
          command.
        </li>
      </ul>

      <h2>Data handling</h2>
      <ul>
        <li>
          Page content and tab metadata are read via the Chrome DevTools Protocol only when your
          local daemon asks, and are sent only to that daemon over localhost.
        </li>
        <li>No analytics, no telemetry, no tracking, no remote servers, no remote code.</li>
        <li>
          The only stored state is the extension's own settings (auto-connect, cached daemon port,
          connection status) and your site-permission policy, kept in <code>chrome.storage</code> on
          your device.
        </li>
      </ul>
      <p>
        The full policy lives at <Link to="/privacy">reins.tech/privacy</Link>. The code is
        MIT-licensed and auditable at{" "}
        <a href="https://github.com/karnstack/reins" target="_blank" rel="noreferrer">
          github.com/karnstack/reins
        </a>
        .
      </p>
    </article>
  );
}
