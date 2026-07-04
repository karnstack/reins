import { resolve } from "node:path";
import type { ConsoleEntry, NetworkEntry, SnapshotRef, Tab } from "@reins/protocol";
import { type ParsedArgs, UsageError } from "./args.js";
import { tabsText } from "./cli-commands.js";

/** One `reins <name>` tool subcommand: flags → /rpc params → printed text. */
export interface ToolCommand {
  method: string;
  usage: string;
  summary: string;
  booleans?: string[];
  multi?: string[];
  build(a: ParsedArgs): Record<string, unknown>;
  /** Compact text output (default: pretty JSON of the raw result). */
  format?(result: unknown, a: ParsedArgs): string;
}

function flagStr(a: ParsedArgs, name: string): string | undefined {
  const v = a.flags[name];
  if (v === undefined) return undefined;
  if (typeof v !== "string") throw new UsageError(`--${name} needs a value`);
  return v;
}

function requireStr(a: ParsedArgs, name: string): string {
  const v = flagStr(a, name);
  if (v === undefined) throw new UsageError(`--${name} is required`);
  return v;
}

function flagInt(a: ParsedArgs, name: string): number | undefined {
  const v = flagStr(a, name);
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isInteger(n)) throw new UsageError(`--${name} must be an integer, got "${v}"`);
  return n;
}

function requireInt(a: ParsedArgs, name: string): number {
  const n = flagInt(a, name);
  if (n === undefined) throw new UsageError(`--${name} is required`);
  return n;
}

function oneOf(a: ParsedArgs, name: string, allowed: string[]): string | undefined {
  const v = flagStr(a, name);
  if (v !== undefined && !allowed.includes(v)) {
    throw new UsageError(`--${name} must be one of ${allowed.join("|")}, got "${v}"`);
  }
  return v;
}

/** Shared routing/targeting flags (--browser, --tab). */
function base(a: ParsedArgs): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const browser = flagStr(a, "browser");
  if (browser !== undefined) out.browserId = browser;
  const tab = flagInt(a, "tab");
  if (tab !== undefined) out.tabId = tab;
  return out;
}

function target(a: ParsedArgs, required: boolean): Record<string, unknown> {
  const ref = flagStr(a, "ref");
  const selector = flagStr(a, "selector");
  if (required && ref === undefined && selector === undefined) {
    throw new UsageError("--ref or --selector is required");
  }
  const out: Record<string, unknown> = {};
  if (ref !== undefined) out.ref = ref;
  if (selector !== undefined) out.selector = selector;
  return out;
}

const ok = () => "ok";

export const TOOL_COMMANDS: Record<string, ToolCommand> = {
  tabs: {
    method: "list_tabs",
    usage: "reins tabs [--browser <id>]",
    summary: "list tabs across all connected browsers",
    build: (a) => {
      const browser = flagStr(a, "browser");
      return browser !== undefined ? { browserId: browser } : {};
    },
    format: (r) => tabsText((r as { tabs: Tab[] }).tabs),
  },
  open: {
    method: "open_tab",
    usage: "reins open <url> [--background]",
    summary: "open a new tab",
    booleans: ["background"],
    build: (a) => {
      const url = a.positional[0];
      if (!url) throw new UsageError("a URL argument is required");
      return { ...base(a), url, activate: a.flags.background !== true };
    },
    format: (r) => `opened tab ${(r as { tabId: number }).tabId}`,
  },
  close: {
    method: "close_tab",
    usage: "reins close --tab <id>",
    summary: "close a tab",
    build: (a) => ({ ...base(a), tabId: requireInt(a, "tab") }),
    format: ok,
  },
  focus: {
    method: "select_tab",
    usage: "reins focus --tab <id>",
    summary: "focus (activate) a tab",
    build: (a) => ({ ...base(a), tabId: requireInt(a, "tab") }),
    format: ok,
  },
  nav: {
    method: "navigate",
    usage: "reins nav <url|back|forward|reload> [--tab <id>]",
    summary: "navigate a tab",
    build: (a) => {
      const to = a.positional[0];
      if (!to)
        throw new UsageError("a destination argument is required (url, back, forward, or reload)");
      return { ...base(a), to };
    },
    format: (r) => `→ ${(r as { url: string }).url}`,
  },
  snapshot: {
    method: "read_snapshot",
    usage: "reins snapshot [--tab <id>] [--max-chars <n>]",
    summary: "list interactive elements with refs (use refs with click/type/…)",
    build: (a) => {
      const maxChars = flagInt(a, "max-chars");
      return { ...base(a), ...(maxChars !== undefined ? { maxChars } : {}) };
    },
    format: (r) => {
      const snap = r as { content: string; refs: SnapshotRef[] };
      return snap.refs.length ? snap.content : "(no interactive elements found)";
    },
  },
  click: {
    method: "click",
    usage: "reins click (--ref <e#> | --selector <css>) [--button right|middle] [--count 2]",
    summary: "click an element",
    build: (a) => {
      const button = oneOf(a, "button", ["left", "right", "middle"]);
      const count = flagInt(a, "count");
      return {
        ...base(a),
        ...target(a, true),
        ...(button !== undefined ? { button } : {}),
        ...(count !== undefined ? { clickCount: count } : {}),
      };
    },
    format: ok,
  },
  type: {
    method: "type",
    usage: 'reins type (--ref <e#> | --selector <css>) --text "…" [--enter]',
    summary: "type into an element (--enter presses Enter after)",
    booleans: ["enter"],
    build: (a) => ({
      ...base(a),
      ...target(a, true),
      text: requireStr(a, "text"),
      submit: a.flags.enter === true,
    }),
    format: ok,
  },
  press: {
    method: "press_key",
    usage: 'reins press --key "Escape" | "Meta+A" | "Shift+Tab" …',
    summary: "press a key or shortcut",
    build: (a) => ({ ...base(a), key: requireStr(a, "key") }),
    format: ok,
  },
  hover: {
    method: "hover",
    usage: "reins hover (--ref <e#> | --selector <css>)",
    summary: "hover an element (menus, tooltips)",
    build: (a) => ({ ...base(a), ...target(a, true) }),
    format: ok,
  },
  scroll: {
    method: "scroll",
    usage: 'reins scroll [--ref <e#> | --selector <css> | --by "dx,dy" | --to top|bottom]',
    summary: "scroll an element into view, by a delta, or to an edge",
    build: (a) => {
      const out: Record<string, unknown> = { ...base(a), ...target(a, false) };
      const by = flagStr(a, "by");
      if (by !== undefined) {
        const m = by.match(/^(-?\d+),(-?\d+)$/);
        if (!m) throw new UsageError(`--by must be "dx,dy", got "${by}"`);
        out.by = { dx: Number(m[1]), dy: Number(m[2]) };
      }
      const to = oneOf(a, "to", ["top", "bottom"]);
      if (to !== undefined) out.to = to;
      if (
        out.ref === undefined &&
        out.selector === undefined &&
        out.by === undefined &&
        out.to === undefined
      ) {
        throw new UsageError("scroll needs --ref, --selector, --by, or --to");
      }
      return out;
    },
    format: ok,
  },
  fill: {
    method: "fill",
    usage: 'reins fill (--ref <e#> | --selector <css>) --value "…"',
    summary: "set an input's value directly (faster than type)",
    build: (a) => ({ ...base(a), ...target(a, true), value: requireStr(a, "value") }),
    format: ok,
  },
  select: {
    method: "select_option",
    usage: 'reins select (--ref <e#> | --selector <css>) --value "…"',
    summary: "choose a <select> option by value or label",
    build: (a) => ({ ...base(a), ...target(a, true), value: requireStr(a, "value") }),
    format: ok,
  },
  upload: {
    method: "upload",
    usage: "reins upload (--ref <e#> | --selector <css>) --file <path> [--file <path>…]",
    summary: "set files on a file input",
    multi: ["file"],
    build: (a) => {
      const files = a.flags.file;
      if (!Array.isArray(files) || files.length === 0) {
        throw new UsageError("--file <path> is required (repeatable)");
      }
      return { ...base(a), ...target(a, true), files: files.map((f) => resolve(f)) };
    },
    format: ok,
  },
  text: {
    method: "read_text",
    usage: "reins text [--ref <e#> | --selector <css>] [--max-chars <n>]",
    summary: "read the page's (or an element's) visible text",
    build: (a) => {
      const maxChars = flagInt(a, "max-chars");
      return { ...base(a), ...target(a, false), ...(maxChars !== undefined ? { maxChars } : {}) };
    },
    format: (r) => (r as { text: string }).text,
  },
  screenshot: {
    method: "screenshot",
    usage: "reins screenshot [--tab <id>] [--full] [--format jpeg] [--out <path>]",
    summary: "capture the page; prints the image file path",
    booleans: ["full"],
    build: (a) => {
      const format = oneOf(a, "format", ["png", "jpeg"]);
      return {
        ...base(a),
        fullPage: a.flags.full === true,
        ...(format !== undefined ? { format } : {}),
      };
    },
    // Output handled by the runner: decodes base64 and writes the file.
  },
  eval: {
    method: "eval_js",
    usage: "reins eval '<expression>' [--await]",
    summary: "evaluate JavaScript in the page, print the value",
    booleans: ["await"],
    build: (a) => {
      const expression = a.positional[0];
      if (!expression) throw new UsageError("an expression argument is required");
      return { ...base(a), expression, awaitPromise: a.flags.await === true };
    },
    format: (r) => JSON.stringify((r as { value: unknown }).value, null, 2),
  },
  wait: {
    method: "wait_for",
    usage:
      "reins wait (--ref <e#> | --selector <css>) [--state visible|hidden|present] [--timeout <ms>]",
    summary: "wait for an element to reach a state",
    build: (a) => {
      const state = oneOf(a, "state", ["visible", "hidden", "present"]);
      const timeout = flagInt(a, "timeout");
      return {
        ...base(a),
        ...target(a, true),
        ...(state !== undefined ? { state } : {}),
        ...(timeout !== undefined ? { timeoutMs: timeout } : {}),
      };
    },
    format: ok,
  },
  console: {
    method: "read_console",
    usage: "reins console [--tab <id>] [--since <ms>] [--level error --level warning…]",
    summary: "read recent console messages",
    multi: ["level"],
    build: (a) => {
      const sinceMs = flagInt(a, "since");
      const levels = a.flags.level;
      return {
        ...base(a),
        ...(sinceMs !== undefined ? { sinceMs } : {}),
        ...(Array.isArray(levels) ? { levels } : {}),
      };
    },
    format: (r) => {
      const { entries } = r as { entries: ConsoleEntry[] };
      if (entries.length === 0) return "(no console entries)";
      return entries.map((e) => `[${e.level}] ${e.text}`).join("\n");
    },
  },
  network: {
    method: "read_network",
    usage: "reins network [--tab <id>] [--since <ms>] [--url <pattern>]",
    summary: "read recent network requests",
    build: (a) => {
      const sinceMs = flagInt(a, "since");
      const urlPattern = flagStr(a, "url");
      return {
        ...base(a),
        ...(sinceMs !== undefined ? { sinceMs } : {}),
        ...(urlPattern !== undefined ? { urlPattern } : {}),
      };
    },
    format: (r) => {
      const { entries } = r as { entries: NetworkEntry[] };
      if (entries.length === 0) return "(no network entries)";
      return entries
        .map((e) => `${e.method} ${e.url}${e.status !== undefined ? ` -> ${e.status}` : ""}`)
        .join("\n");
    },
  },
  resize: {
    method: "resize",
    usage: "reins resize --width 1280 --height 800 [--tab <id>]",
    summary: "resize the tab's browser window",
    build: (a) => ({ ...base(a), width: requireInt(a, "width"), height: requireInt(a, "height") }),
    format: ok,
  },
  dialog: {
    method: "handle_dialog",
    usage: 'reins dialog (--accept | --dismiss) [--text "…"] [--tab <id>]',
    summary: "answer the open alert/confirm/prompt",
    booleans: ["accept", "dismiss"],
    build: (a) => {
      const accept = a.flags.accept === true;
      const dismiss = a.flags.dismiss === true;
      if (accept === dismiss) throw new UsageError("pass exactly one of --accept / --dismiss");
      const promptText = flagStr(a, "text");
      return { ...base(a), accept, ...(promptText !== undefined ? { promptText } : {}) };
    },
    format: ok,
  },
  cdp: {
    method: "cdp",
    usage: "reins cdp <Domain.method> ['<json-params>'] [--tab <id>]",
    summary: "raw Chrome DevTools Protocol call (the escape hatch)",
    build: (a) => {
      const method = a.positional[0];
      if (!method) throw new UsageError("a Domain.method argument is required");
      let params: unknown;
      if (a.positional[1] !== undefined) {
        try {
          params = JSON.parse(a.positional[1]);
        } catch {
          throw new UsageError(`params must be valid JSON, got: ${a.positional[1]}`);
        }
        if (typeof params !== "object" || params === null || Array.isArray(params)) {
          throw new UsageError("params must be a JSON object");
        }
      }
      return { ...base(a), method, ...(params !== undefined ? { params } : {}) };
    },
    format: (r) => JSON.stringify((r as { result: unknown }).result, null, 2),
  },
};
