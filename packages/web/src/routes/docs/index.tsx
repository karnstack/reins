import { createFileRoute, Link } from "@tanstack/react-router";
import { CodeBlock } from "@/components/code-block";
import { StoreReviewBadge } from "@/components/store-review-badge";

export const Route = createFileRoute("/docs/")({
  head: () => ({ meta: [{ title: "Getting started · reins" }] }),
  component: GettingStarted,
});

function GettingStarted() {
  return (
    <article className="prose max-w-[70ch]">
      <h1>Getting started</h1>
      <p>
        reins gives coding agents (Claude Code, Cursor, Codex, Copilot, anything with a shell) full
        control of your actual, logged-in Chromium browser through a CLI and a Manifest V3
        extension. This page takes you from nothing to an agent driving a tab.
      </p>

      <h2>1. Install the CLI</h2>
      <CodeBlock code="npm i -g @karnstack/reins" />
      <p>
        This installs the <code>reins</code> command and the daemon it manages. The daemon is
        invisible plumbing: any command starts it on demand, it binds to <code>127.0.0.1</code>, and{" "}
        <code>reins kill</code> stops it. There is nothing to configure and nothing to keep running.
      </p>

      <h2>2. Add the extension</h2>
      <p>
        <StoreReviewBadge />
      </p>
      <p>
        The Chrome Web Store listing is under review. Until it is approved, install the extension
        straight from the CLI; the npm package carries a full copy:
      </p>
      <CodeBlock code="reins extension" />
      <p>
        That stages the extension at <code>~/.reins/extension</code> and prints the Load-unpacked
        steps. The full walkthrough is on <Link to="/docs/sideload">Install without the store</Link>
        . Once the listing is live, the store install works in every Chromium browser you want
        agents to reach: Chrome, Brave, Edge, Arc, and Dia all work. Either way the extension finds
        the daemon on its own through localhost port discovery; when the toolbar popover turns
        green, it is connected.
      </p>
      <p>Working from a dev build instead? Load the unpacked extension and allow its ID once:</p>
      <CodeBlock code="reins allow <extension-id>" />

      <h2>3. Teach your agent</h2>
      <CodeBlock code="npx skills add karnstack/reins" />
      <p>
        The skill teaches agents the command set and the loop below. Agents without skill support
        can run <code>reins help</code>; the CLI is self-describing.
      </p>

      <h2>4. Verify</h2>
      <CodeBlock
        code={`reins status   # daemon state, port, connected browsers
reins tabs     # every tab across every connected browser
reins doctor   # diagnostic checks when something looks off`}
      />

      <h2>The loop agents use</h2>
      <p>Every page interaction follows the same three-beat rhythm: look, act, verify.</p>
      <CodeBlock
        code={`reins snapshot                      # interactive elements with refs
  e3: input "Email"
  e7: button "Sign in"
reins type --ref e3 --text "you@work.dev"
reins click --ref e7                # act by ref
reins text                          # verify, or reins screenshot`}
      />
      <p>
        Every command accepts <code>--tab &lt;id&gt;</code> (defaults to the active tab),{" "}
        <code>--browser &lt;id&gt;</code> (only needed when several browsers are connected), and{" "}
        <code>--json</code> for raw output.
      </p>
      <p>
        Next: the full <Link to="/docs/commands">command reference</Link>, or how the pieces fit in{" "}
        <Link to="/docs/architecture">architecture</Link>.
      </p>
    </article>
  );
}
