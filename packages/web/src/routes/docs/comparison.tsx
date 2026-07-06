import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/docs/comparison")({
  head: () => ({ meta: [{ title: "How it compares · reins" }] }),
  component: ComparisonPage,
});

const ROWS: Array<{ label: string; reins: string; agentBrowser: string; dev3000: string }> = [
  {
    label: "Built for",
    reins: "driving the browser you already use",
    agentBrowser: "general-purpose automation for agents",
    dev3000: "debugging your local dev server",
  },
  {
    label: "Browser",
    reins: "your real, running browsers — Chrome, Brave, Edge, Arc, Dia, all at once",
    agentBrowser: "its own Chrome for Testing it launches",
    dev3000: "its own monitored Chrome it launches",
  },
  {
    label: "Logged-in sessions",
    reins: "always — it is your profile",
    agentBrowser: "opt-in: reuse a profile's login state or attach to a running Chrome",
    dev3000: "per-project profile that persists between runs",
  },
  {
    label: "Attaches via",
    reins: "MV3 extension + chrome.debugger — no launch flags, no open debug port",
    agentBrowser: "CDP from the outside",
    dev3000: "CDP from the outside",
  },
  {
    label: "Agent interface",
    reins: "CLI + skill; nothing to register per agent",
    agentBrowser: "CLI, plus an optional MCP server",
    dev3000: "CLI + MCP server + unified timeline log",
  },
  {
    label: "Extras",
    reins: "raw CDP escape hatch (reins cdp)",
    agentBrowser: "HAR recording, request mocking, React tree, web vitals",
    dev3000: "server+browser timeline, error replay, d3k fix",
  },
];

function ComparisonPage() {
  return (
    <article className="prose max-w-none">
      <h1>How it compares</h1>
      <p>
        <a href="https://github.com/vercel-labs/agent-browser" target="_blank" rel="noreferrer">
          agent-browser
        </a>{" "}
        and{" "}
        <a href="https://github.com/vercel-labs/dev3000" target="_blank" rel="noreferrer">
          dev3000
        </a>{" "}
        (both Vercel Labs) live in the same neighborhood — CLI-first browser tooling for coding
        agents — but start from a different place: they launch and manage a browser for the agent,
        while reins hands the agent the browser you already have open.
      </p>
      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr className="border-b border-border">
              <th />
              <th>reins</th>
              <th>agent-browser</th>
              <th>dev3000</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => (
              <tr key={row.label} className="border-b border-border">
                <th className="align-top">{row.label}</th>
                <td className="align-top">{row.reins}</td>
                <td className="align-top">{row.agentBrowser}</td>
                <td className="align-top">{row.dev3000}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h2>vs agent-browser</h2>
      <p>
        agent-browser is a fast, general automation CLI that owns its browser: it launches Chrome
        for Testing by default and reaches your real login state only as an opt-in (profile reuse,
        or attaching to a Chrome you started for it). reins starts from the opposite end: an
        extension inside the browsers you already run means every session is authenticated by
        definition, nothing new launches, and no debug port is ever exposed — the daemon only
        accepts the extension's unforgeable origin on 127.0.0.1.
      </p>
      <p>
        If you need headless fleets, request mocking, or CI runs, agent-browser is the better fit;
        if the task is "act as me, in my browser", that's reins.
      </p>
      <h2>vs dev3000</h2>
      <p>
        dev3000 solves a different problem: it wraps your dev server, launches a monitored browser,
        and merges server logs, console, network, and screenshots into one timeline an AI can debug
        from. It's dev-loop observability, not general browser control.
      </p>
      <p>
        They compose: dev3000 watches the app you're building, reins drives the rest of your browser
        — dashboards, docs, the third-party service you're integrating.
      </p>
    </article>
  );
}
