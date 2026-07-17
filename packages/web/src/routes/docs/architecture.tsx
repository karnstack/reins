import { createFileRoute, Link } from "@tanstack/react-router";
import { Fragment } from "react";
import { seo } from "@/lib/seo";

export const Route = createFileRoute("/docs/architecture")({
  head: () => ({
    ...seo({
      title: "Architecture · reins",
      description:
        "How the reins CLI, local daemon, and Chrome extension fit together — one WebSocket on 127.0.0.1, no cloud, nothing to keep running.",
      path: "/docs/architecture",
    }),
  }),
  component: ArchitecturePage,
});

const FLOW: Array<{ name: string; detail: string; via?: string }> = [
  {
    name: "Your agent",
    detail: "Claude Code, Cursor, Codex, anything with a shell",
  },
  {
    via: "shells out",
    name: "reins CLI",
    detail: "@karnstack/reins",
  },
  {
    via: "HTTP /rpc · 127.0.0.1 · auto-spawned",
    name: "reins daemon",
    detail: "one per machine, serves every browser",
  },
  {
    via: "WebSocket · allowlisted chrome-extension:// origins",
    name: "reins extension",
    detail: "MV3; an offscreen document holds the socket",
  },
  {
    via: "chrome.debugger · Chrome DevTools Protocol",
    name: "Your tabs",
    detail: "Chrome, Brave, Edge, Arc, Dia",
  },
];

function ArchitectureDiagram() {
  return (
    <div className="rounded-xl border border-border p-4 sm:p-6">
      {FLOW.map((step) => (
        <Fragment key={step.name}>
          {step.via ? (
            <div className="flex items-center gap-3 py-1.5 pl-6">
              <span
                aria-hidden="true"
                className="relative h-8 w-px bg-violet-600/40 dark:bg-violet-400/40"
              >
                <span className="absolute -bottom-px left-1/2 size-1.5 -translate-x-1/2 rotate-45 border-r border-b border-violet-600/70 dark:border-violet-400/70" />
              </span>
              <p className="font-mono text-xs text-muted-foreground">{step.via}</p>
            </div>
          ) : null}
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 rounded-lg border border-border bg-foreground/2 px-4 py-3">
            <p className="text-base font-medium sm:text-sm">{step.name}</p>
            <p className="text-sm text-muted-foreground">{step.detail}</p>
          </div>
        </Fragment>
      ))}
    </div>
  );
}

function ArchitecturePage() {
  return (
    <article className="prose max-w-[70ch]">
      <h1>Architecture</h1>
      <p>
        reins is three small pieces with one narrow contract between them. Everything runs on your
        machine, and everything binds <code>127.0.0.1</code>.
      </p>
      <ArchitectureDiagram />

      <h2>The CLI</h2>
      <p>
        The CLI is the entire interface: <code>reins tabs</code>, <code>reins click</code>,{" "}
        <code>reins screenshot</code>, and the rest of the{" "}
        <Link to="/docs/commands">command set</Link>. Agents use it because they already have a
        shell: no MCP server to register, no per-agent setup. A skill (
        <code>npx skills add karnstack/reins</code>) teaches agents the loop.
      </p>

      <h2>The daemon</h2>
      <p>
        The daemon is invisible plumbing. Any CLI command spawns it on demand; it exposes an HTTP{" "}
        <code>/rpc</code> endpoint for the CLI and holds the WebSocket that extensions dial into.
        One daemon serves any number of browsers. <code>reins kill</code> stops it, and logs live in{" "}
        <code>~/.reins/logs/</code>.
      </p>

      <h2>The extension</h2>
      <p>
        A Manifest V3 extension. Its service worker executes commands against tabs through{" "}
        <code>chrome.debugger</code> (the Chrome DevTools Protocol), and an offscreen document holds
        the persistent WebSocket to the daemon, because MV3 service workers are suspended when idle
        and can't keep long-lived sockets.
      </p>
      <p>
        The extension discovers the daemon by probing a small set of candidate localhost ports and
        authenticates itself by its <code>chrome-extension://&lt;id&gt;</code> origin, a header the
        browser stamps itself, which web pages and other extensions cannot forge.
      </p>

      <h2>Multiple browsers</h2>
      <p>
        Install the extension in several Chromium browsers (Chrome, Brave, Edge, Arc, Dia) and each
        connects to the same daemon. <code>reins tabs</code> lists every tab with a browser id; pass{" "}
        <code>--browser &lt;id&gt;</code> only when more than one browser is connected. reins never
        guesses which browser you meant.
      </p>

      <h2>Element refs</h2>
      <p>
        <code>reins snapshot</code> assigns stable refs (<code>e5: button "Submit"</code>) to
        interactive elements. Commands act by ref, which survives page repaints better than
        hand-written selectors, and a CSS <code>--selector</code> fallback exists for everything
        else.
      </p>
    </article>
  );
}
