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
        The whole interface. Agents already have a shell, so there is no MCP server to register. A
        skill (<Code>npx skills add karnstack/reins</Code>) teaches them the commands.
      </P>

      <H2 id="daemon">The daemon</H2>
      <P>
        Started by any CLI command. It takes HTTP <Code>/rpc</Code> calls from the CLI and holds the
        WebSocket each browser's extension connects to. Logs are in <Code>~/.reins/logs/</Code>.
      </P>

      <H2 id="extension">The extension</H2>
      <P>
        Its service worker runs commands through <Code>chrome.debugger</Code>. An offscreen document
        holds the WebSocket, because Chrome suspends idle MV3 service workers.
      </P>
      <P>
        It finds the daemon by trying a few localhost ports, and proves who it is by its{" "}
        <Code>chrome-extension://&lt;id&gt;</Code> origin, which pages cannot fake.
      </P>

      <H2 id="multiple-browsers">Multiple browsers</H2>
      <P>
        Each browser with the extension connects to the same daemon. With more than one connected,
        pass <Code>--browser &lt;id&gt;</Code>. reins never guesses; it errors and lists the ones it
        sees.
      </P>

      <H2 id="refs">Element refs</H2>
      <P>
        <Code>reins snapshot</Code> gives each control a ref (<Code>e5: button "Submit"</Code>).
        Refs survive repaints better than hand-written selectors. <Code>--selector</Code> takes CSS
        when you need it.
      </P>
      <Arrow href="/docs/commands">Full command reference</Arrow>
    </>
  );
}
