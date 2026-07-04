import { request as httpRequest } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { BridgeHost } from "./bridge.js";
import { startDaemon } from "./daemon.js";

/** Raw HTTP request with a forged Host header (fetch/undici won't send one). */
function forgedHostRequest(opts: {
  port: number;
  path: string;
  method?: string;
  body?: string;
}): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: "127.0.0.1",
        port: opts.port,
        path: opts.path,
        method: opts.method ?? "GET",
        setHost: false,
        headers: {
          host: "evil.example",
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
      },
      (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      },
    );
    req.on("error", reject);
    req.end(opts.body);
  });
}

const ORIGIN = "chrome-extension://abcdef";
const silent = () => {};
let daemon: Awaited<ReturnType<typeof startDaemon>> | undefined;
let bridge: BridgeHost | undefined;

afterEach(async () => {
  await daemon?.close();
  daemon = undefined;
  bridge = undefined;
});

async function boot() {
  bridge = new BridgeHost({ allowedOrigins: new Set([ORIGIN]), log: silent });
  daemon = await startDaemon({ port: 0, bridge, log: silent });
  return daemon;
}

/** Fake extension: answers list_tabs with one tab. */
function fakeExtension(port: number, browser = "Chrome"): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`, { headers: { origin: ORIGIN } });
  return new Promise((resolve, reject) => {
    ws.on("open", () => ws.send(JSON.stringify({ type: "hello", browser })));
    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === "welcome") resolve(ws);
      if (msg.type === "request" && msg.method === "list_tabs") {
        ws.send(
          JSON.stringify({
            type: "response",
            id: msg.id,
            ok: true,
            result: { tabs: [{ tabId: 1, title: "t", url: "https://x", active: true }] },
          }),
        );
      }
    });
    ws.on("error", reject);
  });
}

async function mcpClient(port: number): Promise<Client> {
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)));
  return client;
}

describe("daemon", () => {
  it("GET /health reports version, paired state, and browsers", async () => {
    const d = await boot();
    let res = await fetch(`http://127.0.0.1:${d.port}/health`);
    expect(res.status).toBe(200);
    let body = (await res.json()) as { ok: boolean; paired: boolean; browsers: unknown[] };
    expect(body.ok).toBe(true);
    expect(body.paired).toBe(false);
    expect(body.browsers).toEqual([]);

    const ext = await fakeExtension(d.port);
    res = await fetch(`http://127.0.0.1:${d.port}/health`);
    body = (await res.json()) as { ok: boolean; paired: boolean; browsers: unknown[] };
    expect(body.paired).toBe(true);
    expect(body.browsers).toHaveLength(1);
    ext.close();
  });

  it("GET /browsers lists connected browsers", async () => {
    const d = await boot();
    const a = await fakeExtension(d.port, "Chrome");
    const b = await fakeExtension(d.port, "Brave");
    const res = await fetch(`http://127.0.0.1:${d.port}/browsers`);
    const body = (await res.json()) as { browsers: Array<{ id: string; browser: string }> };
    expect(body.browsers.map((x) => x.browser)).toEqual(["Chrome", "Brave"]);
    a.close();
    b.close();
  });

  it("GET /tabs aggregates tabs across browsers with tags", async () => {
    const d = await boot();
    const a = await fakeExtension(d.port, "Chrome");
    const b = await fakeExtension(d.port, "Brave");
    const res = await fetch(`http://127.0.0.1:${d.port}/tabs`);
    const body = (await res.json()) as { tabs: Array<{ browser: string; url: string }> };
    expect(body.tabs).toHaveLength(2);
    expect(body.tabs.map((t) => t.browser).sort()).toEqual(["Brave", "Chrome"]);
    a.close();
    b.close();
  });

  it("serves a full MCP session over streamable HTTP (initialize → tools/list → list_tabs)", async () => {
    const d = await boot();
    const ext = await fakeExtension(d.port);
    const client = await mcpClient(d.port);
    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name)).toContain("list_tabs");
    const result = await client.callTool({ name: "list_tabs", arguments: {} });
    expect(JSON.stringify(result.content)).toContain("https://x");
    await client.close();
    ext.close();
  });

  it("supports two concurrent MCP sessions sharing one bridge", async () => {
    const d = await boot();
    const ext = await fakeExtension(d.port);
    const [a, b] = await Promise.all([mcpClient(d.port), mcpClient(d.port)]);
    const [ra, rb] = await Promise.all([
      a.callTool({ name: "list_tabs", arguments: {} }),
      b.callTool({ name: "list_tabs", arguments: {} }),
    ]);
    expect(JSON.stringify(ra.content)).toContain("https://x");
    expect(JSON.stringify(rb.content)).toContain("https://x");
    await Promise.all([a.close(), b.close()]);
    ext.close();
  });

  it("rejects /mcp requests with a foreign Host header (DNS rebinding)", async () => {
    const d = await boot();
    const status = await forgedHostRequest({
      port: d.port,
      path: "/mcp",
      method: "POST",
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "evil", version: "0.0.0" },
        },
      }),
    });
    expect(status).toBeGreaterThanOrEqual(400);
  });

  it("rejects GET endpoints with a foreign Host header (DNS rebinding)", async () => {
    const d = await boot();
    for (const path of ["/health", "/browsers", "/tabs"]) {
      expect(await forgedHostRequest({ port: d.port, path }), path).toBe(403);
    }
  });

  it("404s unknown paths", async () => {
    const d = await boot();
    const res = await fetch(`http://127.0.0.1:${d.port}/nope`);
    expect(res.status).toBe(404);
  });
});
