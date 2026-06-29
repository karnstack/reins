#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { BridgeHost } from "./bridge.js";
import { loadOrCreateConfig } from "./config.js";
import { createServer } from "./create-server.js";

const config = loadOrCreateConfig();
const bridge = new BridgeHost({ port: config.port, token: config.token });

try {
  await bridge.start();
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(
    `reins-mcp: failed to start bridge on port ${config.port}: ${msg}. Another reins server may already be running (set REINS_PORT to use a different port).\n`,
  );
  process.exit(1);
}

const server = createServer(bridge);
const transport = new StdioServerTransport();
await server.connect(transport);
