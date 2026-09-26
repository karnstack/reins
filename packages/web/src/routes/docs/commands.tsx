import { createFileRoute } from "@tanstack/react-router";
import { Fragment } from "react";
import { Code, H1, H2, P, TEXT } from "@/components/md";
import { seo } from "@/lib/seo";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/docs/commands")({
  head: () => ({
    ...seo({
      title: "Commands · reins",
      description:
        "The full reins command reference: tabs, snapshot, click, type, fill, screenshot, console, network, eval, and raw Chrome DevTools Protocol access.",
      path: "/docs/commands",
    }),
  }),
  component: CommandsPage,
});

/** Every group is a heading and a table: the usage, and what it does. */
const GROUPS: Array<{ id: string; title: string; intro?: string; rows: [string, string][] }> = [
  {
    id: "tabs",
    title: "Tabs and pages",
    rows: [
      ["reins tabs [--browser <id>]", "List tabs across all connected browsers."],
      [
        "reins groups [--browser <id>]",
        "List tab groups. reins tabs marks each grouped tab with g<id>.",
      ],
      [
        "reins group --tab <id> [--tab <id> …] [--group <gid>] [--title <t>] [--color <c>] [--collapse|--expand]",
        "Put tabs in a new group, or in an existing one with --group. With --group and no --tab, edit the group.",
      ],
      [
        "reins ungroup --tab <id> [--tab <id> …] | --group <gid>",
        "Take tabs out of their group, or dissolve a whole group. Tabs stay open.",
      ],
      ["reins open <url> [--background]", "Open a new tab."],
      ["reins close --tab <id>", "Close a tab."],
      ["reins focus --tab <id>", "Focus (activate) a tab."],
      ["reins nav <url|back|forward|reload> [--tab <id>]", "Navigate a tab."],
    ],
  },
  {
    id: "interaction",
    title: "Interaction",
    intro: "Interaction commands address elements by ref (from reins snapshot) or by CSS selector.",
    rows: [
      [
        "reins snapshot [--tab <id>] [--max-chars <n>]",
        "List interactive elements with refs. The refs feed click, type and the rest.",
      ],
      [
        "reins click (--ref <e#> | --selector <css>) [--button right|middle] [--count 2]",
        "Click an element.",
      ],
      [
        'reins type (--ref <e#> | --selector <css>) --text "…" [--enter]',
        "Type into an element. --enter presses Enter afterwards.",
      ],
      [
        'reins fill (--ref <e#> | --selector <css>) --value "…"',
        "Set an input's value directly, faster than type.",
      ],
      [
        'reins select (--ref <e#> | --selector <css>) --value "…"',
        "Choose a select option by value or label.",
      ],
      ['reins press --key "Escape" | "Meta+A" | "Shift+Tab"', "Press a key or a shortcut."],
      ["reins hover (--ref <e#> | --selector <css>)", "Hover an element, for menus and tooltips."],
      [
        'reins scroll [--ref <e#> | --selector <css> | --by "dx,dy" | --to top|bottom]',
        "Scroll an element into view, by a delta, or to an edge.",
      ],
      [
        "reins upload (--ref <e#> | --selector <css>) --file <path> […]",
        "Set files on a file input.",
      ],
      [
        "reins wait (--ref <e#> | --selector <css>) [--state visible|hidden|attached]",
        "Wait for an element to reach a state.",
      ],
      [
        'reins dialog (--accept | --dismiss) [--text "…"] [--tab <id>]',
        "Answer the open alert, confirm or prompt.",
      ],
      ["reins resize --width 1280 --height 800 [--tab <id>]", "Resize the tab's browser window."],
    ],
  },
  {
    id: "reading",
    title: "Reading",
    rows: [
      [
        "reins text [--ref <e#> | --selector <css>] [--max-chars <n>]",
        "Read the page's (or an element's) visible text.",
      ],
      [
        "reins screenshot [--tab <id>] [--full] [--format jpeg] [--out <path>]",
        "Capture the page. Prints the image file path.",
      ],
      [
        "reins console [--tab <id>] [--since <ms>] [--level error …]",
        "Read recent console messages.",
      ],
      [
        "reins network [--tab <id>] [--since <ms>] [--url <pattern>]",
        "Read recent network requests.",
      ],
    ],
  },
  {
    id: "advanced",
    title: "Advanced",
    rows: [
      [
        "reins eval '<expression>' [--await]",
        "Evaluate JavaScript in the page and print the value.",
      ],
      [
        "reins cdp <Domain.method> ['<json-params>'] [--tab <id>]",
        "Raw Chrome DevTools Protocol call. The escape hatch for cookies, geolocation, PDF, tracing and everything else the curated commands do not wrap.",
      ],
      ["reins daemon", "Run the daemon in the foreground. Normally it is auto-spawned."],
    ],
  },
  {
    id: "policy",
    title: "Site permissions",
    intro:
      "The shell can inspect and tighten the per-site policy, never loosen it. Grants happen in the extension popup. See the Site permissions page for the full model.",
    rows: [
      [
        "reins policy [--browser <id>]",
        "Show the default tier, the rules, and the effective tier for each open tab's host.",
      ],
      [
        "reins policy deny <pattern>",
        "Block a site entirely. The pattern is a host or a *.wildcard.",
      ],
      ["reins policy readonly <pattern>", "Tighten a site to read-only: agents can look, not act."],
      [
        "reins policy allow <pattern>",
        "Always errors. Grants require the extension popup, and the error message says exactly that.",
      ],
    ],
  },
  {
    id: "management",
    title: "Management",
    rows: [
      ["reins browsers", "List browsers connected to the daemon."],
      ["reins status", "Daemon state, port, and connected browsers."],
      [
        "reins extension",
        "Stage the bundled extension for install without the Chrome Web Store (Load unpacked).",
      ],
      [
        "reins extension --reload",
        "Re-stage and reload an unpacked (dev or sideloaded) extension in place.",
      ],
      ["reins allow <id>", "Allow an unpacked or dev extension to connect."],
      ["reins audit [--denied]", "Render the audit trail, or only what policy blocked."],
      ["reins restart", "Restart the background daemon, e.g. after changing config."],
      ["reins kill", "Stop the background daemon."],
      ["reins doctor", "Run diagnostic checks."],
      ["reins logs", "Show the daemon log location and recent lines."],
      ["reins help [command]", "Overall help, or one command's usage."],
    ],
  },
];

/**
 * One command, the way a man page sets it: the usage on its own line, and
 * what it does under it. A two-column table cramps usages this long, and
 * wrapping them mid-flag makes them unreadable.
 */
function Command({ usage, summary }: { usage: string; summary: string }) {
  return (
    <div className={cn(TEXT, "mt-5 max-w-[68ch]")}>
      {/* Wraps rather than scrolls. A scroll box per command would be forty
          keyboard stops down the page, and a long flag list is still legible
          broken across lines when the wrap is indented under the command. */}
      <p className="whitespace-pre-wrap [text-indent:-2ch] pl-[2ch]">{usage}</p>
      <p className="text-pretty text-muted-foreground">{summary}</p>
    </div>
  );
}

function CommandsPage() {
  return (
    <>
      <H1>Commands</H1>
      <P>
        The CLI is the whole interface: agents shell out to it, and so can you. The commands that
        act on a page or a tab share three flags: <Code>--tab &lt;id&gt;</Code> (the active tab by
        default), <Code>--browser &lt;id&gt;</Code> (only needed when several browsers are
        connected, and the ids come from <Code>reins tabs</Code>) and <Code>--json</Code> for raw
        results. The management commands (<Code>status</Code>, <Code>doctor</Code>,{" "}
        <Code>kill</Code>, <Code>help</Code>) take none of them.
      </P>
      {GROUPS.map((group) => (
        <Fragment key={group.id}>
          <H2 id={group.id}>{group.title}</H2>
          {group.intro ? <P>{group.intro}</P> : null}
          {group.rows.map(([usage, summary]) => (
            <Command key={usage} usage={usage} summary={summary} />
          ))}
        </Fragment>
      ))}
    </>
  );
}
