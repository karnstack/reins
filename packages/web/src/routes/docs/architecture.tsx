import { createFileRoute } from "@tanstack/react-router";
import { Arrow, Code, H1, H2, P, Pre } from "@/components/md";
import { seo } from "@/lib/seo";

export const Route = createFileRoute("/docs/architecture")({
  head: () => ({
    ...seo({
      title: "Architecture · reins",
      description:
        "How the reins CLI, local daemon, and Chrome extension fit together: one WebSocket on 127.0.0.1, no cloud, nothing to keep running.",
      path: "/docs/architecture",
    }),
  }),
  component: ArchitecturePage,
});

const FLOW = `your agent          Claude Code, Cursor, Codex, anything with a shell
     │              shells out
     ▼
reins CLI           @karnstack/reins
     │              HTTP /rpc · 127.0.0.1 · daemon auto-spawned
     ▼
reins daemon        one per machine, serves every browser
     │              WebSocket · allowlisted chrome-extension:// origins
     ▼
reins extension     MV3; an offscreen document holds the socket
     │              chrome.debugger · Chrome DevTools Protocol
     ▼
your tabs           Chrome, Brave, Edge, Arc, Dia`;

const FLOW_LABEL =
  "Your agent shells out to the reins CLI. The CLI speaks HTTP to a daemon on 127.0.0.1, which it spawns on demand. The daemon holds a WebSocket open to the Manifest V3 extension, accepted only from allowlisted chrome-extension:// origins. The extension drives your tabs through chrome.debugger, the Chrome DevTools Protocol.";

function ArchitecturePage() {
  return (
    <>
      <H1>Architecture</H1>
      <P>
        reins is three small pieces with one narrow contract between them. Everything runs on your
        machine, and everything binds <Code>127.0.0.1</Code>.
      </P>
      <Pre label={FLOW_LABEL}>{FLOW}</Pre>

      <H2 id="cli">The CLI</H2>
      <P>
        The CLI is the entire interface: <Code>reins tabs</Code>, <Code>reins click</Code>,{" "}
        <Code>reins screenshot</Code> and the rest of the command set. Agents use it because they
        already have a shell: no MCP server to register, no per-agent setup. A skill (
        <Code>npx skills add karnstack/reins</Code>) teaches agents the loop.
      </P>

      <H2 id="daemon">The daemon</H2>
      <P>
        You never run the daemon yourself. Any CLI command spawns it on demand. It exposes an HTTP{" "}
        <Code>/rpc</Code> endpoint for the CLI and holds the WebSocket that extensions dial into.
        One daemon serves any number of browsers. <Code>reins kill</Code> stops it, and logs live in{" "}
        <Code>~/.reins/logs/</Code>.
      </P>

      <H2 id="extension">The extension</H2>
      <P>
        A Manifest V3 extension. Its service worker executes commands against tabs through{" "}
        <Code>chrome.debugger</Code> (the Chrome DevTools Protocol), and an offscreen document holds
        the persistent WebSocket to the daemon, because MV3 service workers are suspended when idle
        and cannot keep long-lived sockets.
      </P>
      <P>
        The extension discovers the daemon by probing a small set of candidate localhost ports, and
        authenticates itself by its <Code>chrome-extension://&lt;id&gt;</Code> origin, a header the
        browser stamps itself, which web pages and other extensions cannot forge.
      </P>

      <H2 id="multiple-browsers">Multiple browsers</H2>
      <P>
        Install the extension in several Chromium browsers (Chrome, Brave, Edge, Arc, Dia) and each
        connects to the same daemon. <Code>reins tabs</Code> lists every tab with a browser id. Pass{" "}
        <Code>--browser &lt;id&gt;</Code> only when more than one browser is connected. reins never
        guesses which browser you meant: it errors and names the ones it can see.
      </P>

      <H2 id="refs">Element refs</H2>
      <P>
        <Code>reins snapshot</Code> assigns stable refs (<Code>e5: button "Submit"</Code>) to
        interactive elements. Commands act by ref, which survives page repaints better than a
        hand-written selector, and a CSS <Code>--selector</Code> fallback exists for everything
        else.
      </P>
      <Arrow href="/docs/commands">Full command reference</Arrow>
    </>
  );
}
