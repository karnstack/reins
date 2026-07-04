import {
  createServer as createHttpServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { BridgeHost } from "./bridge.js";
import type { Log } from "./log.js";
import { handleRpc, RpcBadRequest } from "./rpc.js";
import { packageVersion } from "./version.js";

export interface Daemon {
  port: number;
  close(): Promise<void>;
}

const MAX_BODY_BYTES = 1024 * 1024;

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new RpcBadRequest("request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "null"));
      } catch {
        reject(new RpcBadRequest("request body is not valid JSON"));
      }
    });
    req.on("error", reject);
  });
}

/**
 * One HTTP server on 127.0.0.1: POST /rpc (CLI → browser commands),
 * GET /health, POST /shutdown, and the extension WS via upgrade → bridge.
 * Every route validates the Host header — a DNS-rebound web page must reach
 * none of this.
 */
export async function startDaemon(opts: {
  port: number;
  bridge: BridgeHost;
  log: Log;
  onShutdown?: () => void;
}): Promise<Daemon> {
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
    if (path === "/rpc" && req.method === "POST") {
      void readJsonBody(req)
        .then((body) => handleRpc(opts.bridge, body))
        .then((result) => sendJson(res, 200, { result }))
        .catch((err) => {
          const message = err instanceof Error ? err.message : String(err);
          sendJson(res, err instanceof RpcBadRequest ? 400 : 502, { error: message });
        });
      return;
    }
    if (path === "/shutdown" && req.method === "POST") {
      opts.log("reins: shutdown requested over /shutdown");
      sendJson(res, 200, { ok: true });
      if (opts.onShutdown) setImmediate(opts.onShutdown);
      return;
    }
    res.writeHead(404).end();
  });

  function actualPort(): number {
    const addr = httpServer.address();
    return addr && typeof addr === "object" ? addr.port : opts.port;
  }

  opts.bridge.attach(httpServer);

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(opts.port, "127.0.0.1", resolve);
  });
  opts.log(`reins: daemon listening on http://127.0.0.1:${actualPort()} (rpc: /rpc)`);

  return {
    port: actualPort(),
    close: async () => {
      await opts.bridge.stop();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    },
  };
}
