import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  ClickShape,
  CloseTabParams,
  ConsoleParams,
  ConsoleResult,
  EvalParams,
  EvalResult,
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
  TypeShape,
  WaitForShape,
} from "@reins/protocol";
import type { BridgePort } from "./bridge.js";

const notConnected = {
  isError: true as const,
  content: [
    {
      type: "text" as const,
      text: "No browser connected. Run `reins pair` and connect the extension.",
    },
  ],
};

/** Build the reins MCP server, wired to a bridge that reaches the browser. */
export function createServer(bridge: BridgePort): McpServer {
  const server = new McpServer({ name: "reins", version: "0.0.0" });

  server.registerTool(
    "ping",
    { description: "Health check. Returns 'pong'.", inputSchema: {} },
    async () => ({ content: [{ type: "text", text: "pong" }] }),
  );

  server.registerTool(
    "list_tabs",
    { description: "List open browser tabs (id, title, url, active).", inputSchema: {} },
    async () => {
      if (!bridge.paired) return notConnected;
      const raw = await bridge.request("list_tabs", {});
      const { tabs } = ListTabsResult.parse(raw);
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
      const { url } = NavigateResult.parse(await bridge.request("navigate", args));
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
      const snap = SnapshotResult.parse(await bridge.request("read_snapshot", args));
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
      OkResult.parse(await bridge.request("click", args));
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
      OkResult.parse(await bridge.request("type", args));
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
      const { tabId } = OpenTabResult.parse(await bridge.request("open_tab", args));
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
      OkResult.parse(await bridge.request("close_tab", args));
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
      OkResult.parse(await bridge.request("select_tab", args));
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
      const shot = ScreenshotResult.parse(await bridge.request("screenshot", args));
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
      const { value } = EvalResult.parse(await bridge.request("eval_js", args));
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
      OkResult.parse(await bridge.request("wait_for", args));
      return { content: [{ type: "text", text: "ok" }] };
    },
  );

  server.registerTool(
    "read_console",
    {
      description:
        "Read recent console messages (level, text, timestamp) for a tab. Filter by sinceMs / levels. Note: only captures events since monitoring began for that tab.",
      inputSchema: ConsoleParams.shape,
    },
    async (args) => {
      if (!bridge.paired) return notConnected;
      const { entries } = ConsoleResult.parse(await bridge.request("read_console", args));
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
      const { entries } = NetworkResult.parse(await bridge.request("read_network", args));
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
