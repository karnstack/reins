import { createFileRoute } from "@tanstack/react-router";
import { A, H1, H2, P, Table } from "@/components/md";
import { seo } from "@/lib/seo";

export const Route = createFileRoute("/docs/comparison")({
  head: () => ({
    ...seo({
      title: "How it compares · reins",
      description:
        "How reins compares to agent-browser, dev3000, and playwright-mcp, and when to pick each one for agent-driven browser automation.",
      path: "/docs/comparison",
    }),
  }),
  component: ComparisonPage,
});

function ComparisonPage() {
  return (
    <>
      <H1>How it compares</H1>
      <P>
        <A href="https://github.com/vercel-labs/agent-browser">agent-browser</A> and{" "}
        <A href="https://github.com/vercel-labs/dev3000">dev3000</A> (Vercel Labs) and{" "}
        <A href="https://github.com/microsoft/playwright-mcp">playwright-mcp</A> (Microsoft) are all
        browser tooling for coding agents, and they all start from the same place: by default each
        one launches and manages a browser for the agent. reins starts from the other end. It hands
        the agent the browser you already have open.
      </P>

      <H2 id="reins">reins</H2>
      <Table
        rows={[
          ["Built for", "driving the browser you already use"],
          ["Browser", "your real, running browsers: Chrome, Brave, Edge, Arc, Dia, all at once"],
          ["Logged-in", "always, because it is your profile"],
          ["Attaches via", "MV3 extension plus chrome.debugger. No launch flags, no debug port."],
          ["Agent interface", "CLI and a skill. Nothing to register per agent."],
          ["Extras", "raw CDP escape hatch, per-site permission tiers, audit trail"],
        ]}
      />

      <H2 id="agent-browser">agent-browser</H2>
      <Table
        rows={[
          ["Built for", "general-purpose automation for agents"],
          ["Browser", "its own Chrome for Testing, which it launches"],
          ["Logged-in", "opt-in: reuse a profile's login state, or attach to a running Chrome"],
          ["Attaches via", "CDP from the outside"],
          ["Agent interface", "CLI, plus an optional MCP server"],
          ["Extras", "HAR recording, request mocking, React tree, web vitals"],
        ]}
      />
      <P>
        agent-browser is a fast, general automation CLI that owns its browser. reins puts an
        extension inside the browsers you already run, so every session is authenticated by
        definition, nothing new launches, and no debug port is ever exposed. The daemon only accepts
        the extension's unforgeable origin on 127.0.0.1.
      </P>
      <P>
        If you need headless fleets, request mocking or CI runs, agent-browser is the better fit. If
        the task is "act as me, in my browser", that is reins.
      </P>

      <H2 id="dev3000">dev3000</H2>
      <Table
        rows={[
          ["Built for", "debugging your local dev server"],
          ["Browser", "its own monitored Chrome, which it launches"],
          ["Logged-in", "per-project profile that persists between runs"],
          ["Attaches via", "CDP from the outside"],
          ["Agent interface", "CLI, MCP server, unified timeline log"],
          ["Extras", "server and browser timeline, error replay, d3k fix"],
        ]}
      />
      <P>
        dev3000 solves a different problem: it wraps your dev server, launches a monitored browser,
        and merges server logs, console, network and screenshots into one timeline an AI can debug
        from. That is dev-loop observability, not general browser control.
      </P>
      <P>
        They compose. dev3000 watches the app you are building, and reins drives the rest of your
        browser: dashboards, docs, the third-party service you are integrating.
      </P>

      <H2 id="playwright-mcp">playwright-mcp</H2>
      <Table
        rows={[
          ["Built for", "browser automation as an MCP server"],
          ["Browser", "its own Playwright-managed browser: Chromium, Firefox or WebKit"],
          ["Logged-in", "its own persistent profile; real Chrome and Edge tabs via opt-in"],
          ["Attaches via", "Playwright launch; opt-in extension or CDP endpoint"],
          ["Agent interface", "MCP server (stdio or HTTP), registered per client"],
          ["Extras", "isolated contexts, device emulation, vision and PDF caps, traces"],
        ]}
      />
      <P>
        The closest comparison: its extension mode can also drive existing tabs in your real browser
        (Chrome and Edge only). The defaults differ. playwright-mcp launches a Playwright-managed
        browser with its own persistent profile, and everything flows through an MCP server you
        register in each client. reins is a plain CLI, so any agent with a shell drives your
        everyday browsers with no per-agent setup, and one daemon serves them all at once.
      </P>
      <P>
        Pick playwright-mcp for cross-engine coverage (Firefox, WebKit), device emulation, or
        clean-room isolated sessions. Pick reins when the point is acting as you, in the browser you
        already work in.
      </P>
    </>
  );
}
