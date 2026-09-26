import { createFileRoute } from "@tanstack/react-router";
import { A, Code, Column, H1, H2, P, Ul } from "@/components/md";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { seo } from "@/lib/seo";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    ...seo({
      title: "Privacy policy · reins",
      description:
        "The reins privacy policy: everything stays on your machine. No analytics, no telemetry. The only remote service is TypeSafe, and only if you opt in to reins do.",
      path: "/privacy",
    }),
  }),
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <>
      <SiteHeader />
      <main>
        <Column className="py-10">
          <p className="text-base/7 sm:text-sm/7">
            <A href="/">&larr; reins.tech</A>
          </p>
          <div className="mt-10">
            <H1>Privacy policy</H1>
          </div>
          <P muted>Last updated: September 27, 2026</P>
          <P>
            reins is a browser extension that lets a local daemon on your own machine (installed by
            you, via the <Code>@karnstack/reins</Code> CLI) drive your browser. It is a developer
            tool; you install both halves yourself.
          </P>

          <H2 id="what-it-handles">What data reins handles</H2>
          <Ul>
            <li>
              Page content and tab metadata (titles, URLs, screenshots, console and network activity
              of tabs you interact with through your agent) are read through the Chrome DevTools
              Protocol only when the local reins daemon asks, and are sent only to that daemon over
              a WebSocket bound to <Code>127.0.0.1</Code> on your machine.
            </li>
            <li>
              Settings (the auto-connect toggle and the cached daemon port) and your site-permission
              policy (per-site access tiers: deny, read or full) are stored in{" "}
              <Code>chrome.storage.local</Code> on your device. Connection status is stored in{" "}
              <Code>chrome.storage.session</Code>.
            </li>
          </Ul>

          <H2 id="what-it-does-not">What reins does not do</H2>
          <Ul>
            <li>
              No data is sent to the developer. The only remote service reins can talk to is
              TypeSafe, and only when you've opted in (see below). There is no analytics, telemetry,
              tracking or advertising of any kind.
            </li>
            <li>No data is sold or shared with third parties.</li>
            <li>
              Nothing is collected in the background: the extension only acts on explicit commands
              sent through the reins CLI on your own machine.
            </li>
            <li>The extension loads no remote code.</li>
          </Ul>

          <H2 id="reins-do">Optional: reins do with Jev</H2>
          <P>
            <Code>reins do</Code> is off until you save a TypeSafe API key (
            <Code>reins key set typesafe</Code>, or the Jev section of the extension popup). The key
            is stored in <Code>~/.reins/credentials.json</Code> on your machine (readable only by
            you). Only the local reins daemon reads that file; the popup passes the key to the
            daemon once when you save it.
          </P>
          <P>
            While a <Code>reins do</Code> run is working, the daemon (not the extension) sends this
            to <Code>api.typesafe.ai</Code>, under your own TypeSafe account:
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
            Never sent: password, file and hidden inputs. Nothing at all is sent unless you saved a
            key and ran <Code>reins do</Code>. The extension itself still makes no remote requests.
          </P>

          <H2 id="security">Security</H2>
          <Ul>
            <li>
              The daemon accepts the extension's connection only from <Code>127.0.0.1</Code>, and
              only from allowlisted extension identities (<Code>chrome-extension://&lt;id&gt;</Code>{" "}
              origins, which browsers set themselves and web pages cannot forge).
            </li>
            <li>
              Chrome shows its native "is debugging this browser" banner whenever the extension is
              attached to a tab, and the popup's Disconnect toggle cuts the connection at any time.
            </li>
          </Ul>

          <H2 id="contact">Contact</H2>
          <P>
            Questions or concerns: open an issue at{" "}
            <A href="https://github.com/karnstack/reins/issues">
              github.com/karnstack/reins/issues
            </A>{" "}
            or email <A href="mailto:mail@karngyan.com">mail@karngyan.com</A>.
          </P>
        </Column>
      </main>
      <SiteFooter />
    </>
  );
}
