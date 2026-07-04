import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  ClickShape,
  CloseTabParams,
  ConsoleParams,
  ConsoleResult,
  EvalParams,
  EvalResult,
  ListTabsParams,
  ListTabsResult,
  NavigateParams,
  NavigateResult,
  NetworkParams,
  NetworkResult,
  OkResult,
  OpenTabParams,
  OpenTabResult,
  ScreenshotParams,
  ScreenshotResult,
  SelectTabParams,
  SnapshotParams,
  SnapshotResult,
  type Tab,
  TypeShape,
  WaitForShape,
} from "@reins/protocol";
import type { BridgePort } from "./bridge.js";
import { packageVersion } from "./version.js";

const notConnected = {
  isError: true as const,
  content: [
    {
      type: "text" as const,
      text: "No browser connected. Install the reins extension and make sure the reins daemon is running (`reins status`).",
    },
  ],
};

/** List tabs across connected browsers (all, or one), tagging each tab with
 *  its browserId + browser name. Shared by the list_tabs tool and GET /tabs. */
export async function listAllTabs(bridge: BridgePort, browserId?: string): Promise<Tab[]> {
  const targets = browserId ? bridge.browsers.filter((b) => b.id === browserId) : bridge.browsers;
  if (browserId !== undefined && targets.length === 0) {
    const roster = bridge.browsers.map((b) => `${b.id} (${b.browser})`).join(", ");
    throw new Error(`unknown browserId "${browserId}"${roster ? ` — connected: ${roster}` : ""}`);
  }
  const results = await Promise.all(
    targets.map(async (b) => {
      const raw = await bridge.request("list_tabs", {}, { browserId: b.id });
      const { tabs } = ListTabsResult.parse(raw);
      return tabs.map((t) => ({ ...t, browserId: b.id, browser: b.browser }));
    }),
  );
  return results.flat();
}

/** Split the agent-facing args into routing (browserId) + payload for the browser. */
function route<T extends { browserId?: string }>(
  args: T,
): {
  browserId: string | undefined;
  params: Omit<T, "browserId">;
} {
  const { browserId, ...params } = args;
  return { browserId, params };
}

/** Build the reins MCP server, wired to a bridge that reaches the browser(s). */
export function createServer(bridge: BridgePort): McpServer {
  const server = new McpServer({ name: "reins", version: packageVersion() });

  server.registerTool(
    "ping",
    { description: "Health check. Returns 'pong'.", inputSchema: {} },
    async () => ({ content: [{ type: "text", text: "pong" }] }),
  );

  server.registerTool(
    "list_tabs",
    {
      description:
        "List open tabs across all connected browsers (id, title, url, active, browserId). Pass browserId to limit to one browser; use the browserId values with the other tools when several browsers are connected.",
      inputSchema: ListTabsParams.shape,
    },
    async (args) => {
      if (!bridge.paired) return notConnected;
      const tabs = await listAllTabs(bridge, args.browserId);
      return { content: [{ type: "text", text: JSON.stringify(tabs, null, 2) }] };
    },
  );

  server.registerTool(
    "navigate",
    {
      description: "Navigate the tab to a URL, or 'back' | 'forward' | 'reload'.",
      inputSchema: NavigateParams.shape,
    },
    async (args) => {
      if (!bridge.paired) return notConnected;
      const { browserId, params } = route(args);
      const { url } = NavigateResult.parse(await bridge.request("navigate", params, { browserId }));
      return { content: [{ type: "text", text: `Navigated to ${url}` }] };
    },
  );

  server.registerTool(
    "read_snapshot",
    {
      description:
        "Snapshot the page's interactive and labelled elements, returning a ref for each (use refs with click/type). The `mode` param is reserved for future text/a11y/dom variants.",
      inputSchema: SnapshotParams.shape,
    },
    async (args) => {
      if (!bridge.paired) return notConnected;
      const { browserId, params } = route(args);
      const snap = SnapshotResult.parse(
        await bridge.request("read_snapshot", params, { browserId }),
      );
      const lines = snap.refs.map((r) => `${r.ref}: ${r.role ?? ""} ${r.name ?? ""}`.trim());
      const text = lines.length ? lines.join("\n") : "(no interactive elements found)";
      return { content: [{ type: "text", text }] };
    },
  );

  server.registerTool(
    "click",
    {
      description: "Click an element by ref (from read_snapshot) or CSS selector.",
      inputSchema: ClickShape,
    },
    async (args) => {
      if (!bridge.paired) return notConnected;
      const { browserId, params } = route(args);
      OkResult.parse(await bridge.request("click", params, { browserId }));
      return { content: [{ type: "text", text: "ok" }] };
    },
  );

  server.registerTool(
    "type",
    {
      description: "Type text into an element by ref or CSS selector; set submit to press Enter.",
      inputSchema: TypeShape,
    },
    async (args) => {
      if (!bridge.paired) return notConnected;
      const { browserId, params } = route(args);
      OkResult.parse(await bridge.request("type", params, { browserId }));
      return { content: [{ type: "text", text: "ok" }] };
    },
  );

  server.registerTool(
    "open_tab",
    {
      description: "Open a new browser tab at the given URL; optionally activate (focus) it.",
      inputSchema: OpenTabParams.shape,
    },
    async (args) => {
      if (!bridge.paired) return notConnected;
      const { browserId, params } = route(args);
      const { tabId } = OpenTabResult.parse(
        await bridge.request("open_tab", params, { browserId }),
      );
      return { content: [{ type: "text", text: `Opened tab ${tabId}` }] };
    },
  );

  server.registerTool(
    "close_tab",
    {
      description: "Close a browser tab by its numeric tab ID.",
      inputSchema: CloseTabParams.shape,
    },
    async (args) => {
      if (!bridge.paired) return notConnected;
      const { browserId, params } = route(args);
      OkResult.parse(await bridge.request("close_tab", params, { browserId }));
      return { content: [{ type: "text", text: "ok" }] };
    },
  );

  server.registerTool(
    "select_tab",
    {
      description: "Switch focus to a browser tab by its numeric tab ID.",
      inputSchema: SelectTabParams.shape,
    },
    async (args) => {
      if (!bridge.paired) return notConnected;
      const { browserId, params } = route(args);
      OkResult.parse(await bridge.request("select_tab", params, { browserId }));
      return { content: [{ type: "text", text: "ok" }] };
    },
  );

  server.registerTool(
    "screenshot",
    {
      description: "Capture a screenshot of the browser tab as a base64-encoded image.",
      inputSchema: ScreenshotParams.shape,
    },
    async (args) => {
      if (!bridge.paired) return notConnected;
      const { browserId, params } = route(args);
      const shot = ScreenshotResult.parse(
        await bridge.request("screenshot", params, { browserId }),
      );
      return { content: [{ type: "image", data: shot.data, mimeType: shot.mimeType }] };
    },
  );

  server.registerTool(
    "eval_js",
    {
      description: "Evaluate a JavaScript expression in the browser tab and return the result.",
      inputSchema: EvalParams.shape,
    },
    async (args) => {
      if (!bridge.paired) return notConnected;
      const { browserId, params } = route(args);
      const { value } = EvalResult.parse(await bridge.request("eval_js", params, { browserId }));
      return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
    },
  );

  server.registerTool(
    "wait_for",
    {
      description:
        "Wait for an element (by ref or CSS selector) to reach a given visibility state.",
      inputSchema: WaitForShape,
    },
    async (args) => {
      if (!bridge.paired) return notConnected;
      const { browserId, params } = route(args);
      OkResult.parse(await bridge.request("wait_for", params, { browserId }));
      return { content: [{ type: "text", text: "ok" }] };
    },
  );

  server.registerTool(
    "read_console",
    {
      description:
        "Read recent console messages (level, text, timestamp) for a tab. Filter by sinceMs / levels. Levels use CDP console types: log, info, warning, error, debug (note: 'warning' not 'warn'). Captures console.* calls only — not uncaught exceptions. Note: only captures events since monitoring began for that tab.",
      inputSchema: ConsoleParams.shape,
    },
    async (args) => {
      if (!bridge.paired) return notConnected;
      const { browserId, params } = route(args);
      const { entries } = ConsoleResult.parse(
        await bridge.request("read_console", params, { browserId }),
      );
      const text = entries.length
        ? entries.map((e) => `[${e.level}] ${e.text}`).join("\n")
        : "(no console entries)";
      return { content: [{ type: "text", text }] };
    },
  );

  server.registerTool(
    "read_network",
    {
      description:
        "Read recent network requests (method, url, status) for a tab. Filter by sinceMs / urlPattern. Note: only captures events since monitoring began for that tab.",
      inputSchema: NetworkParams.shape,
    },
    async (args) => {
      if (!bridge.paired) return notConnected;
      const { browserId, params } = route(args);
      const { entries } = NetworkResult.parse(
        await bridge.request("read_network", params, { browserId }),
      );
      const text = entries.length
        ? entries
            .map((e) => `${e.method} ${e.url}${e.status !== undefined ? ` -> ${e.status}` : ""}`)
            .join("\n")
        : "(no network entries)";
      return { content: [{ type: "text", text }] };
    },
  );

  return server;
}
