import { randomUUID } from "node:crypto";
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { BridgeHost } from "./bridge.js";
import { createServer, listAllTabs } from "./create-server.js";
import type { Log } from "./log.js";
import { packageVersion } from "./version.js";

export interface Daemon {
  port: number;
  close(): Promise<void>;
}

/**
 * One HTTP server on 127.0.0.1: streamable-HTTP MCP at /mcp (session per
 * client), status GETs at /health /browsers /tabs, and the extension WS via
 * upgrade → bridge. Every route validates the Host header — a DNS-rebound
 * web page must reach none of this.
 */
export async function startDaemon(opts: {
  port: number;
  bridge: BridgeHost;
  log: Log;
}): Promise<Daemon> {
  const sessions = new Map<string, StreamableHTTPServerTransport>();

  function allowedHosts(): string[] {
    const port = actualPort();
    return [`127.0.0.1:${port}`, `localhost:${port}`];
  }

  function hostAllowed(req: IncomingMessage): boolean {
    return req.headers.host !== undefined && allowedHosts().includes(req.headers.host);
  }

  function sendJson(res: ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  }

  const httpServer = createHttpServer((req, res) => {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    if (path === "/mcp") {
      // The SDK transport does its own Host validation (enableDnsRebindingProtection).
      void handleMcp(req, res).catch((err) => {
        opts.log(`reins: /mcp error: ${err instanceof Error ? err.message : String(err)}`);
        if (!res.headersSent) res.writeHead(500).end();
      });
      return;
    }
    if (!hostAllowed(req)) {
      sendJson(res, 403, { error: "forbidden" });
      return;
    }
    if (path === "/health") {
      sendJson(res, 200, {
        ok: true,
        version: packageVersion(),
        paired: opts.bridge.paired,
        browsers: opts.bridge.browsers,
      });
      return;
    }
    if (path === "/browsers") {
      sendJson(res, 200, { browsers: opts.bridge.browsers });
      return;
    }
    if (path === "/tabs") {
      void listAllTabs(opts.bridge)
        .then((tabs) => sendJson(res, 200, { tabs }))
        .catch((err) =>
          sendJson(res, 502, { error: err instanceof Error ? err.message : String(err) }),
        );
      return;
    }
    res.writeHead(404).end();
  });

  async function handleMcp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const sessionId = req.headers["mcp-session-id"];
    const existing = typeof sessionId === "string" ? sessions.get(sessionId) : undefined;
    if (existing) {
      await existing.handleRequest(req, res);
      return;
    }
    if (req.method !== "POST") {
      sendJson(res, 400, { error: "unknown or missing mcp-session-id" });
      return;
    }
    // New session: the SDK validates that the first POST is an initialize.
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      enableDnsRebindingProtection: true,
      allowedHosts: allowedHosts(),
      onsessioninitialized: (sid) => {
        sessions.set(sid, transport);
        opts.log(`reins: mcp session opened (${sid})`);
      },
    });
    transport.onclose = () => {
      if (transport.sessionId && sessions.delete(transport.sessionId)) {
        opts.log(`reins: mcp session closed (${transport.sessionId})`);
      }
    };
    const server = createServer(opts.bridge);
    await server.connect(transport);
    await transport.handleRequest(req, res);
  }

  function actualPort(): number {
    const addr = httpServer.address();
    return addr && typeof addr === "object" ? addr.port : opts.port;
  }

  opts.bridge.attach(httpServer);

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(opts.port, "127.0.0.1", resolve);
  });
  opts.log(`reins: daemon listening on http://127.0.0.1:${actualPort()} (mcp: /mcp)`);

  return {
    port: actualPort(),
    close: async () => {
      for (const t of sessions.values()) await t.close().catch(() => {});
      sessions.clear();
      await opts.bridge.stop();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    },
  };
}
