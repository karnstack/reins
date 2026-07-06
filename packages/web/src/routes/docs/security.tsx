import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/docs/security")({
  head: () => ({ meta: [{ title: "Security — reins" }] }),
  component: SecurityPage,
});

function SecurityPage() {
  return (
    <article className="prose max-w-[70ch]">
      <h1>Security</h1>
      <p>
        A tool that drives your logged-in browser deserves a paranoid design. reins keeps the attack
        surface small by having no cloud half at all — the pieces only ever talk to each other, on
        your machine.
      </p>

      <h2>Network surface</h2>
      <ul>
        <li>
          Everything binds <code>127.0.0.1</code> — neither the daemon nor the extension is
          reachable from the network.
        </li>
        <li>
          <code>/rpc</code> and the other daemon endpoints validate the <code>Host</code> header, so
          web pages can't reach the daemon even through rebound DNS.
        </li>
        <li>
          The daemon accepts extension WebSocket connections only from exact allowlisted{" "}
          <code>chrome-extension://&lt;id&gt;</code> origins. Browsers stamp that header themselves
          — pages and other extensions can't forge it. Dev builds are added explicitly with{" "}
          <code>reins allow &lt;id&gt;</code>.
        </li>
      </ul>

      <h2>Visibility and control</h2>
      <ul>
        <li>
          Chrome shows its native "is being debugged" banner whenever the extension is attached to a
          tab — you always know when an agent is acting.
        </li>
        <li>The toolbar popup's Disconnect toggle severs the daemon connection instantly.</li>
        <li>
          Nothing happens in the background: the extension only acts on explicit commands sent
          through the CLI on your machine.
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
          The only stored state is the extension's own settings — auto-connect, cached daemon port,
          connection status — kept in <code>chrome.storage</code> on your device.
        </li>
      </ul>
      <p>
        The full policy lives at <Link to="/privacy">reins.karnstack.com/privacy</Link>. The code is
        MIT-licensed and auditable at{" "}
        <a href="https://github.com/karnstack/reins" target="_blank" rel="noreferrer">
          github.com/karnstack/reins
        </a>
        .
      </p>
    </article>
  );
}
