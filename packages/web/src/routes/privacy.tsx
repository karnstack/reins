import { createFileRoute } from "@tanstack/react-router";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

export const Route = createFileRoute("/privacy")({
  head: () => ({ meta: [{ title: "Privacy policy · reins" }] }),
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:px-8">
        <article className="prose max-w-[70ch]">
          <h1>Privacy policy</h1>
          <p>Last updated: July 4, 2026</p>
          <p>
            reins is a browser extension that lets a local daemon on your own machine (installed by
            you, via the <code>@karnstack/reins</code> CLI) drive your browser. It is a developer
            tool; you install both halves yourself.
          </p>

          <h2>What data reins handles</h2>
          <ul>
            <li>
              Page content and tab metadata (titles, URLs, screenshots, console and network activity
              of tabs you interact with through your agent) are read via the Chrome DevTools
              Protocol only when the local reins daemon asks, and are sent only to that daemon over
              a WebSocket bound to <code>127.0.0.1</code> on your machine.
            </li>
            <li>
              Settings (the auto-connect toggle and the cached daemon port) are stored in{" "}
              <code>chrome.storage.local</code> on your device. Connection status is stored in{" "}
              <code>chrome.storage.session</code>.
            </li>
          </ul>

          <h2>What reins does not do</h2>
          <ul>
            <li>
              No data is sent to the developer or to any remote server. There is no analytics,
              telemetry, tracking, or advertising of any kind.
            </li>
            <li>No data is sold or shared with third parties.</li>
            <li>
              Nothing is collected in the background: the extension only acts on explicit commands
              sent through the reins CLI on your own machine.
            </li>
            <li>The extension loads no remote code.</li>
          </ul>

          <h2>Security</h2>
          <ul>
            <li>
              The daemon accepts the extension's connection only from <code>127.0.0.1</code> and
              only from allowlisted extension identities (<code>chrome-extension://&lt;id&gt;</code>{" "}
              origins, which browsers set themselves and web pages cannot forge).
            </li>
            <li>
              Chrome shows its native "is debugging this browser" banner whenever the extension is
              attached to a tab; the popup's Disconnect toggle severs the connection at any time.
            </li>
          </ul>

          <h2>Contact</h2>
          <p>
            Questions or concerns: open an issue at{" "}
            <a href="https://github.com/karnstack/reins/issues" target="_blank" rel="noreferrer">
              github.com/karnstack/reins/issues
            </a>{" "}
            or email <a href="mailto:mail@karngyan.com">mail@karngyan.com</a>.
          </p>
        </article>
      </main>
      <SiteFooter />
    </>
  );
}
