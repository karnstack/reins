import { createFileRoute } from "@tanstack/react-router";
import { Fragment } from "react";
import { CodeBlock } from "@/components/code-block";

export const Route = createFileRoute("/docs/commands")({
  head: () => ({ meta: [{ title: "Commands · reins" }] }),
  component: CommandsPage,
});

interface Command {
  usage: string;
  summary: string;
}

const GROUPS: Array<{ title: string; intro?: string; commands: Command[] }> = [
  {
    title: "Tabs & pages",
    commands: [
      { usage: "reins tabs [--browser <id>]", summary: "List tabs across all connected browsers." },
      { usage: "reins open <url> [--background]", summary: "Open a new tab." },
      { usage: "reins close --tab <id>", summary: "Close a tab." },
      { usage: "reins focus --tab <id>", summary: "Focus (activate) a tab." },
      { usage: "reins nav <url|back|forward|reload> [--tab <id>]", summary: "Navigate a tab." },
    ],
  },
  {
    title: "Interaction",
    intro: "Interaction commands address elements by ref (from reins snapshot) or by CSS selector.",
    commands: [
      {
        usage: "reins snapshot [--tab <id>] [--max-chars <n>]",
        summary: "List interactive elements with refs; the refs feed click, type, and friends.",
      },
      {
        usage: "reins click (--ref <e#> | --selector <css>) [--button right|middle] [--count 2]",
        summary: "Click an element.",
      },
      {
        usage: 'reins type (--ref <e#> | --selector <css>) --text "…" [--enter]',
        summary: "Type into an element; --enter presses Enter afterwards.",
      },
      {
        usage: 'reins fill (--ref <e#> | --selector <css>) --value "…"',
        summary: "Set an input's value directly, faster than type.",
      },
      {
        usage: 'reins select (--ref <e#> | --selector <css>) --value "…"',
        summary: "Choose a <select> option by value or label.",
      },
      {
        usage: 'reins press --key "Escape" | "Meta+A" | "Shift+Tab"',
        summary: "Press a key or shortcut.",
      },
      {
        usage: "reins hover (--ref <e#> | --selector <css>)",
        summary: "Hover an element for menus and tooltips.",
      },
      {
        usage: 'reins scroll [--ref <e#> | --selector <css> | --by "dx,dy" | --to top|bottom]',
        summary: "Scroll an element into view, by a delta, or to an edge.",
      },
      {
        usage: "reins upload (--ref <e#> | --selector <css>) --file <path> [--file <path>…]",
        summary: "Set files on a file input.",
      },
      {
        usage: "reins wait (--ref <e#> | --selector <css>) [--state visible|hidden|attached]",
        summary: "Wait for an element to reach a state.",
      },
      {
        usage: 'reins dialog (--accept | --dismiss) [--text "…"] [--tab <id>]',
        summary: "Answer the open alert, confirm, or prompt.",
      },
      {
        usage: "reins resize --width 1280 --height 800 [--tab <id>]",
        summary: "Resize the tab's browser window.",
      },
    ],
  },
  {
    title: "Reading",
    commands: [
      {
        usage: "reins text [--ref <e#> | --selector <css>] [--max-chars <n>]",
        summary: "Read the page's (or an element's) visible text.",
      },
      {
        usage: "reins screenshot [--tab <id>] [--full] [--format jpeg] [--out <path>]",
        summary: "Capture the page; prints the image file path.",
      },
      {
        usage: "reins console [--tab <id>] [--since <ms>] [--level error --level warning…]",
        summary: "Read recent console messages.",
      },
      {
        usage: "reins network [--tab <id>] [--since <ms>] [--url <pattern>]",
        summary: "Read recent network requests.",
      },
    ],
  },
  {
    title: "Advanced",
    commands: [
      {
        usage: "reins eval '<expression>' [--await]",
        summary: "Evaluate JavaScript in the page and print the value.",
      },
      {
        usage: "reins cdp <Domain.method> ['<json-params>'] [--tab <id>]",
        summary:
          "Raw Chrome DevTools Protocol call: the escape hatch for cookies, geolocation, PDF, tracing, and everything else the curated commands don't wrap.",
      },
      {
        usage: "reins daemon",
        summary: "Run the daemon in the foreground (normally auto-spawned).",
      },
    ],
  },
  {
    title: "Site permissions",
    intro:
      "The shell can inspect and tighten the per-site policy, never loosen it — grants happen in the extension popup. See the Site permissions page for the full model.",
    commands: [
      {
        usage: "reins policy [--browser <id>]",
        summary:
          "Show the default tier, the rules, and the effective tier for each open tab's host.",
      },
      {
        usage: "reins policy deny <pattern>",
        summary: "Block a site entirely; the pattern is a host or a *.wildcard.",
      },
      {
        usage: "reins policy readonly <pattern>",
        summary: "Tighten a site to read-only: agents can look but not act.",
      },
      {
        usage: "reins policy allow <pattern>",
        summary:
          "Always errors — grants require the extension popup, and the error message says exactly that.",
      },
    ],
  },
  {
    title: "Management",
    commands: [
      { usage: "reins browsers", summary: "List browsers connected to the daemon." },
      { usage: "reins status", summary: "Daemon state, port, and connected browsers." },
      {
        usage: "reins extension",
        summary:
          "Stage the bundled extension for install without the Chrome Web Store (Load unpacked).",
      },
      { usage: "reins allow <id>", summary: "Allow an unpacked/dev extension to connect." },
      { usage: "reins kill", summary: "Stop the background daemon." },
      { usage: "reins doctor", summary: "Run diagnostic checks." },
      { usage: "reins logs", summary: "Show the daemon log location and recent lines." },
      { usage: "reins help [command]", summary: "Overall help, or a command's usage." },
    ],
  },
];

function CommandsPage() {
  return (
    <article className="prose max-w-[70ch]">
      <h1>Commands</h1>
      <p>
        The CLI is the whole interface: agents shell out to it, and so can you. Every command
        accepts <code>--tab &lt;id&gt;</code> (defaults to the active tab),{" "}
        <code>--browser &lt;id&gt;</code> (only needed when several browsers are connected; ids come
        from <code>reins tabs</code>), and <code>--json</code> for raw results.
      </p>
      {GROUPS.map((group) => (
        <Fragment key={group.title}>
          <h2>{group.title}</h2>
          {group.intro ? <p>{group.intro}</p> : null}
          {group.commands.map((command) => (
            <Fragment key={command.usage}>
              <CodeBlock code={command.usage} />
              <p>{command.summary}</p>
            </Fragment>
          ))}
        </Fragment>
      ))}
    </article>
  );
}
