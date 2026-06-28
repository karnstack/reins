import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/** Build the reins MCP server. M0: a single `ping` tool. */
export function createServer(): McpServer {
  const server = new McpServer({ name: "reins", version: "0.0.0" });

  server.registerTool(
    "ping",
    { description: "Health check. Returns 'pong'.", inputSchema: {} },
    async () => ({ content: [{ type: "text", text: "pong" }] }),
  );

  return server;
}
