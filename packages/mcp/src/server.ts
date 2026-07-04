#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { BridgeHost } from "./bridge.js";
import { loadOrCreateConfig } from "./config.js";
import { createServer } from "./create-server.js";
import { createLogger } from "./log.js";

const log = createLogger();
const config = loadOrCreateConfig();
// Interim: empty allowlist until Task 3 (allowlist) + Task 5 (serve) land.
const bridge = new BridgeHost({ allowedOrigins: new Set<string>(), log });

try {
  await bridge.listen(config.port);
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  log(
    `reins-mcp: failed to start bridge on port ${config.port}: ${msg}. Another reins server may already be running (set REINS_PORT to use a different port).`,
  );
  process.exit(1);
}

const server = createServer(bridge);
const transport = new StdioServerTransport();

// Without this the WebSocket server keeps the event loop alive after the MCP
// client goes away, leaving an orphaned process squatting on the bridge port.
let shuttingDown = false;
async function shutdown(reason: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  log(`reins-mcp: shutting down (${reason})`);
  await bridge.stop().catch(() => {});
  await server.close().catch(() => {});
  process.exit(0);
}

server.server.onclose = () => void shutdown("client closed the session");
process.stdin.on("end", () => void shutdown("stdin closed"));
process.stdin.on("close", () => void shutdown("stdin closed"));
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

await server.connect(transport);
log("reins-mcp: MCP server ready (stdio)");
