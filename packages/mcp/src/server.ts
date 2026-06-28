#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { BridgeHost } from "./bridge.js";
import { loadOrCreateConfig } from "./config.js";
import { createServer } from "./create-server.js";

const config = loadOrCreateConfig();
const bridge = new BridgeHost({ port: config.port, token: config.token });
await bridge.start();

const server = createServer(bridge);
const transport = new StdioServerTransport();
await server.connect(transport);
