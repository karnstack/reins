import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  ClickShape,
  CloseTabParams,
  ListTabsResult,
  NavigateParams,
  NavigateResult,
  OkResult,
  OpenTabParams,
  OpenTabResult,
  SelectTabParams,
  SnapshotParams,
  SnapshotResult,
  TypeShape,
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

  return server;
}
