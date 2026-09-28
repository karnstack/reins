import { createFileRoute } from "@tanstack/react-router";
import { A, H1, H2, P } from "@/components/md";
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
        The other browser tools for coding agents launch a browser of their own by default. reins
        uses the one you already have open, so you are already logged in everywhere.
      </P>

      <H2 id="agent-browser">agent-browser</H2>
      <P>
        <A href="https://github.com/vercel-labs/agent-browser">agent-browser</A> (Vercel Labs) is a
        fast automation CLI that launches its own Chrome for Testing. It can reuse a profile's
        logins or attach to a running Chrome if you set that up. It adds HAR recording, request
        mocking and web vitals.
      </P>
      <P>
        Pick it for headless runs, CI and request mocking. Pick reins to act as you, in your
        browser.
      </P>

      <H2 id="dev3000">dev3000</H2>
      <P>
        <A href="https://github.com/vercel-labs/dev3000">dev3000</A> (Vercel Labs) wraps your dev
        server, launches a monitored browser, and merges server logs, console, network and
        screenshots into one timeline for an AI to debug from.
      </P>
      <P>
        Different job, and they combine well: dev3000 watches the app you are building, reins drives
        everything else in your browser.
      </P>

      <H2 id="playwright-mcp">playwright-mcp</H2>
      <P>
        <A href="https://github.com/microsoft/playwright-mcp">playwright-mcp</A> (Microsoft) is an
        MCP server that launches a Playwright browser with its own profile. It has an opt-in
        extension mode that drives your real Chrome or Edge tabs, the closest thing to reins. You
        register it in each agent.
      </P>
      <P>
        Pick it for Firefox and WebKit, device emulation, or clean isolated sessions. Pick reins for
        a plain CLI any agent can use with no setup, across all your Chromium browsers at once.
      </P>

      <H2 id="reins">What reins adds</H2>
      <P>
        An extension inside your browser instead of a debug port, per-site permission tiers, a
        redacted audit trail, and raw CDP when the built-in commands are not enough.
      </P>
    </>
  );
}
