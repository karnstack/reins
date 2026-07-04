import { request as httpRequest } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
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
          accept: "application/json",
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

async function boot(onShutdown?: () => void) {
  bridge = new BridgeHost({ allowedOrigins: new Set([ORIGIN]), log: silent });
  daemon = await startDaemon({ port: 0, bridge, log: silent, onShutdown });
  return daemon;
}

/** Fake extension: answers list_tabs with one tab and echoes eval_js params. */
function fakeExtension(port: number, browser = "Chrome"): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`, { headers: { origin: ORIGIN } });
  return new Promise((resolve, reject) => {
    ws.on("open", () => ws.send(JSON.stringify({ type: "hello", browser })));
    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === "welcome") resolve(ws);
      if (msg.type !== "request") return;
      if (msg.method === "list_tabs") {
        ws.send(
          JSON.stringify({
            type: "response",
            id: msg.id,
            ok: true,
            result: { tabs: [{ tabId: 1, title: "t", url: "https://x", active: true }] },
          }),
        );
      } else if (msg.method === "eval_js") {
        ws.send(
          JSON.stringify({
            type: "response",
            id: msg.id,
            ok: true,
            result: { value: { echoed: msg.params, browser } },
          }),
        );
      } else {
        ws.send(
          JSON.stringify({
            type: "response",
            id: msg.id,
            ok: false,
            error: { code: "dispatch", message: `unknown method: ${msg.method}` },
          }),
        );
      }
    });
    ws.on("error", reject);
  });
}

interface RpcReply {
  status: number;
  json: { result?: { tabs?: Array<{ browser: string }>; value?: unknown }; error?: string };
}

async function rpc(port: number, body: unknown): Promise<RpcReply> {
  const res = await fetch(`http://127.0.0.1:${port}/rpc`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as RpcReply["json"] };
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

  it("POST /rpc list_tabs aggregates across browsers with tags", async () => {
    const d = await boot();
    const a = await fakeExtension(d.port, "Chrome");
    const b = await fakeExtension(d.port, "Brave");
    const { status, json } = await rpc(d.port, { method: "list_tabs" });
    expect(status).toBe(200);
    expect(json.result?.tabs).toHaveLength(2);
    expect(json.result?.tabs?.map((t) => t.browser).sort()).toEqual(["Brave", "Chrome"]);
    a.close();
    b.close();
  });

  it("POST /rpc routes params.browserId to the right browser", async () => {
    const d = await boot();
    const a = await fakeExtension(d.port, "Chrome");
    const b = await fakeExtension(d.port, "Brave");
    const { json } = await rpc(d.port, {
      method: "eval_js",
      params: { browserId: "b2", expression: "1" },
    });
    // browserId is routing-only: split off before the payload reaches the browser.
    expect(json.result?.value).toEqual({ echoed: { expression: "1" }, browser: "Brave" });
    a.close();
    b.close();
  });

  it("POST /rpc with several browsers and no browserId is a 502 naming the roster", async () => {
    const d = await boot();
    const a = await fakeExtension(d.port, "Chrome");
    const b = await fakeExtension(d.port, "Brave");
    const { status, json } = await rpc(d.port, { method: "eval_js", params: { expression: "1" } });
    expect(status).toBe(502);
    expect(json.error).toContain("b1 (Chrome)");
    expect(json.error).toContain("b2 (Brave)");
    a.close();
    b.close();
  });

  it("POST /rpc bubbles browser-side errors as 502", async () => {
    const d = await boot();
    const ext = await fakeExtension(d.port);
    const { status, json } = await rpc(d.port, { method: "bogus_method" });
    expect(status).toBe(502);
    expect(json.error).toContain("unknown method");
    ext.close();
  });

  it("POST /rpc rejects malformed bodies with 400", async () => {
    const d = await boot();
    for (const body of [{ params: {} }, { method: "" }, [], 42]) {
      const { status } = await rpc(d.port, body);
      expect(status, JSON.stringify(body)).toBe(400);
    }
    const raw = await fetch(`http://127.0.0.1:${d.port}/rpc`, {
      method: "POST",
      body: "not json",
    });
    expect(raw.status).toBe(400);
  });

  it("POST /shutdown replies ok and fires onShutdown", async () => {
    const onShutdown = vi.fn();
    const d = await boot(onShutdown);
    const res = await fetch(`http://127.0.0.1:${d.port}/shutdown`, { method: "POST" });
    expect(res.status).toBe(200);
    expect((await res.json()) as { ok: boolean }).toEqual({ ok: true });
    await vi.waitFor(() => expect(onShutdown).toHaveBeenCalledOnce());
  });

  it("rejects every route on a foreign Host header (DNS rebinding)", async () => {
    const d = await boot();
    expect(await forgedHostRequest({ port: d.port, path: "/health" })).toBe(403);
    expect(
      await forgedHostRequest({
        port: d.port,
        path: "/rpc",
        method: "POST",
        body: JSON.stringify({ method: "list_tabs" }),
      }),
    ).toBe(403);
    expect(await forgedHostRequest({ port: d.port, path: "/shutdown", method: "POST" })).toBe(403);
  });

  it("404s unknown paths and the retired MCP-era endpoints", async () => {
    const d = await boot();
    for (const path of ["/nope", "/mcp", "/browsers", "/tabs"]) {
      const res = await fetch(`http://127.0.0.1:${d.port}${path}`, { method: "POST" });
      expect(res.status, path).toBe(404);
    }
  });

  it("GET /rpc is not a thing (POST only)", async () => {
    const d = await boot();
    const res = await fetch(`http://127.0.0.1:${d.port}/rpc`);
    expect(res.status).toBe(404);
  });
});
