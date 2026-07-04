import { createServer as createHttpServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { BridgeHost } from "./bridge.js";

const ALLOWED = "chrome-extension://abcdef";
let host: BridgeHost | undefined;
let httpServer: Server | undefined;

afterEach(async () => {
  await host?.stop();
  host = undefined;
  if (httpServer) {
    await new Promise((r) => httpServer?.close(() => r(undefined)));
    httpServer = undefined;
  }
});

/** Connect a stand-in extension client and resolve once it is welcomed. */
function connectClient(
  port: number,
  opts: { origin?: string; browser?: string } = {},
): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`, {
    headers: { origin: opts.origin ?? ALLOWED },
  });
  return new Promise((resolve, reject) => {
    ws.on("open", () =>
      ws.send(JSON.stringify({ type: "hello", browser: opts.browser ?? "test" })),
    );
    ws.on("message", (data) => {
      if (JSON.parse(data.toString()).type === "welcome") resolve(ws);
    });
    ws.on("close", (code) => reject(new Error(`closed ${code}`)));
    ws.on("error", reject);
  });
}

/** Answer list_tabs on a connected stand-in with a fixed marker result. */
function answerListTabs(ws: WebSocket, marker: string): void {
  ws.on("message", (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.type === "request" && msg.method === "list_tabs") {
      ws.send(
        JSON.stringify({ type: "response", id: msg.id, ok: true, result: { tabs: [marker] } }),
      );
    }
  });
}

function newHost() {
  return new BridgeHost({ allowedOrigins: new Set([ALLOWED]), log: () => {} });
}

describe("BridgeHost (listen mode)", () => {
  it("welcomes an allowlisted origin and reports paired", async () => {
    host = newHost();
    await host.listen(0);
    const client = await connectClient(host.port);
    expect(host.paired).toBe(true);
    client.close();
  });

  it("rejects a non-allowlisted extension origin (exact match, not prefix)", async () => {
    host = newHost();
    await host.listen(0);
    await expect(
      connectClient(host.port, { origin: "chrome-extension://evilzz" }),
    ).rejects.toThrow();
    expect(host.paired).toBe(false);
  });

  it("rejects a web-page origin", async () => {
    host = newHost();
    await host.listen(0);
    await expect(connectClient(host.port, { origin: "https://evil.example" })).rejects.toThrow();
  });

  it("rejects a missing origin", async () => {
    host = newHost();
    await host.listen(0);
    const port = host.port;
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    await expect(
      new Promise((resolve, reject) => {
        ws.on("open", () => ws.send(JSON.stringify({ type: "hello", browser: "test" })));
        ws.on("message", (data) => {
          if (JSON.parse(data.toString()).type === "welcome") resolve(undefined);
        });
        ws.on("close", (code) => reject(new Error(`closed ${code}`)));
        ws.on("error", reject);
      }),
    ).rejects.toThrow();
  });

  it("closes a connection sending a malformed hello (code 4001)", async () => {
    host = newHost();
    await host.listen(0);
    const ws = new WebSocket(`ws://127.0.0.1:${host.port}`, { headers: { origin: ALLOWED } });
    await expect(
      new Promise((resolve, reject) => {
        ws.on("open", () => ws.send(JSON.stringify({ type: "hello" })));
        ws.on("message", (data) => {
          if (JSON.parse(data.toString()).type === "welcome") resolve(undefined);
        });
        ws.on("close", (code) => reject(new Error(`closed ${code}`)));
        ws.on("error", reject);
      }),
    ).rejects.toThrow("closed 4001");
  });

  it("round-trips a request to the connected client", async () => {
    host = newHost();
    await host.listen(0);
    const client = await connectClient(host.port);
    client.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === "request" && msg.method === "list_tabs") {
        client.send(
          JSON.stringify({ type: "response", id: msg.id, ok: true, result: { tabs: [] } }),
        );
      }
    });
    expect(await host.request("list_tabs", {})).toEqual({ tabs: [] });
    client.close();
  });

  it("rejects requests when nothing is connected", async () => {
    host = newHost();
    await host.listen(0);
    await expect(host.request("list_tabs", {})).rejects.toThrow(/not connected/i);
  });

  it("rejects a request that times out", async () => {
    host = newHost();
    await host.listen(0);
    const client = await connectClient(host.port);
    await expect(host.request("list_tabs", {}, { timeoutMs: 100 })).rejects.toThrow(/timed out/i);
    client.close();
  });

  it("rejects in-flight requests when the client disconnects", async () => {
    host = newHost();
    await host.listen(0);
    const client = await connectClient(host.port);
    client.on("message", (data) => {
      if (JSON.parse(data.toString()).type === "request") client.close();
    });
    await expect(host.request("list_tabs", {}, { timeoutMs: 10_000 })).rejects.toThrow(
      /disconnected/i,
    );
  });

  it("a malformed response frame is ignored — the pending request times out", async () => {
    host = newHost();
    await host.listen(0);
    const client = await connectClient(host.port);
    client.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === "request") {
        client.send(JSON.stringify({ type: "response", id: 42, ok: true, result: "bad" }));
      }
    });
    await expect(host.request("list_tabs", {}, { timeoutMs: 200 })).rejects.toThrow(/timed out/i);
    client.close();
  });

  it("tracks several browsers at once and routes by browserId", async () => {
    host = newHost();
    await host.listen(0);
    const a = await connectClient(host.port, { browser: "Chrome" });
    const b = await connectClient(host.port, { browser: "Brave" });
    answerListTabs(a, "from-a");
    answerListTabs(b, "from-b");

    expect(host.paired).toBe(true);
    expect(host.browsers.map((x) => x.browser)).toEqual(["Chrome", "Brave"]);

    const [idA, idB] = host.browsers.map((x) => x.id);
    expect(await host.request("list_tabs", {}, { browserId: idA })).toEqual({ tabs: ["from-a"] });
    expect(await host.request("list_tabs", {}, { browserId: idB })).toEqual({ tabs: ["from-b"] });
    a.close();
    b.close();
  });

  it("errors on an ambiguous request when several browsers are connected", async () => {
    host = newHost();
    await host.listen(0);
    const a = await connectClient(host.port, { browser: "Chrome" });
    const b = await connectClient(host.port, { browser: "Brave" });
    await expect(host.request("list_tabs", {})).rejects.toThrow(/several browsers connected/i);
    a.close();
    b.close();
  });

  it("errors on an unknown browserId, naming the live ones", async () => {
    host = newHost();
    await host.listen(0);
    const a = await connectClient(host.port, { browser: "Chrome" });
    await expect(host.request("list_tabs", {}, { browserId: "nope" })).rejects.toThrow(
      /unknown browserId/i,
    );
    a.close();
  });

  it("routes to the single browser when browserId is omitted", async () => {
    host = newHost();
    await host.listen(0);
    const a = await connectClient(host.port, { browser: "Chrome" });
    answerListTabs(a, "solo");
    expect(await host.request("list_tabs", {})).toEqual({ tabs: ["solo"] });
    a.close();
  });

  it("removes a browser from the roster when it disconnects", async () => {
    host = newHost();
    await host.listen(0);
    const a = await connectClient(host.port, { browser: "Chrome" });
    const b = await connectClient(host.port, { browser: "Brave" });
    expect(host.browsers).toHaveLength(2);
    const closed = new Promise((r) => a.on("close", r));
    a.terminate();
    await closed;
    await new Promise((r) => setTimeout(r, 50));
    expect(host.browsers).toHaveLength(1);
    expect(host.browsers[0]?.browser).toBe("Brave");
    b.close();
  });

  it("listen() rejects on a busy port", async () => {
    host = newHost();
    await host.listen(0);
    const other = newHost();
    await expect(other.listen(host.port)).rejects.toThrow();
    await other.stop();
  });

  it("stop() terminates a connected client", async () => {
    host = newHost();
    await host.listen(0);
    const client = await connectClient(host.port);
    const closed = new Promise<void>((resolve, reject) => {
      client.on("close", () => resolve());
      setTimeout(() => reject(new Error("client did not close within 1000ms")), 1000);
    });
    await host.stop();
    await closed;
  });
});

describe("BridgeHost (attach mode)", () => {
  it("serves WS upgrades on a caller-owned HTTP server and leaves it open on stop()", async () => {
    httpServer = createHttpServer();
    await new Promise<void>((r) => httpServer?.listen(0, "127.0.0.1", r));
    const port = (httpServer.address() as { port: number }).port;
    host = newHost();
    host.attach(httpServer);
    const client = await connectClient(port);
    expect(host.paired).toBe(true);
    client.close();
    await host.stop();
    host = undefined;
    expect(httpServer.listening).toBe(true);
  });

  it("rejects a bad-origin upgrade before the WS handshake completes", async () => {
    httpServer = createHttpServer();
    await new Promise<void>((r) => httpServer?.listen(0, "127.0.0.1", r));
    const port = (httpServer.address() as { port: number }).port;
    host = newHost();
    host.attach(httpServer);
    await expect(connectClient(port, { origin: "https://evil.example" })).rejects.toThrow();
    expect(host.paired).toBe(false);
  });
});
