import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ListTabsResult } from "@reins/protocol";
import type { BridgePort } from "./bridge.js";

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
      if (!bridge.paired) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: "No browser connected. Run `reins pair` and connect the extension.",
            },
          ],
        };
      }
      const raw = await bridge.request("list_tabs", {});
      const { tabs } = ListTabsResult.parse(raw);
      return { content: [{ type: "text", text: JSON.stringify(tabs, null, 2) }] };
    },
  );

  return server;
}
