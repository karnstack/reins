import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  ClickShape,
  ListTabsResult,
  NavigateParams,
  NavigateResult,
  OkResult,
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
        "Snapshot the page (text | a11y | dom). Returns content plus element refs for click/type.",
      inputSchema: SnapshotParams.shape,
    },
    async (args) => {
      if (!bridge.paired) return notConnected;
      const snap = SnapshotResult.parse(await bridge.request("read_snapshot", args));
      const refs = snap.refs
        .map((r) => `${r.ref}: ${r.role ?? ""} ${r.name ?? ""}`.trim())
        .join("\n");
      return { content: [{ type: "text", text: `${snap.content}\n\n--- refs ---\n${refs}` }] };
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

  return server;
}
