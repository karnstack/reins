import { WebSocket } from "ws";
import { afterEach, describe, expect, it } from "vitest";
import { BridgeHost } from "./bridge.js";

const TOKEN = "test-token";
let host: BridgeHost | undefined;

afterEach(async () => {
  await host?.stop();
  host = undefined;
});

/** Connect a stand-in extension client and resolve once it is welcomed. */
function connectClient(port: number, opts: { token?: string; origin?: string } = {}): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`, {
    headers: { origin: opts.origin ?? "chrome-extension://abcdef" },
  });
  return new Promise((resolve, reject) => {
    ws.on("open", () => ws.send(JSON.stringify({ type: "hello", token: opts.token ?? TOKEN, browser: "test" })));
    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === "welcome") resolve(ws);
    });
    ws.on("close", (code) => reject(new Error(`closed ${code}`)));
    ws.on("error", reject);
  });
}

describe("BridgeHost", () => {
  it("welcomes a client with valid origin + token and reports paired", async () => {
    host = new BridgeHost({ port: 0, token: TOKEN });
    await host.start();
    const client = await connectClient(host.port);
    expect(host.paired).toBe(true);
    client.close();
  });

  it("closes a client with a bad token (code 4001)", async () => {
    host = new BridgeHost({ port: 0, token: TOKEN });
    await host.start();
    await expect(connectClient(host.port, { token: "wrong" })).rejects.toThrow("closed 4001");
    expect(host.paired).toBe(false);
  });

  it("closes a client with a disallowed origin (code 4003)", async () => {
    host = new BridgeHost({ port: 0, token: TOKEN });
    await host.start();
    await expect(connectClient(host.port, { origin: "https://evil.example" })).rejects.toThrow("closed 4003");
  });

  it("round-trips a request to the paired client", async () => {
    host = new BridgeHost({ port: 0, token: TOKEN });
    await host.start();
    const client = await connectClient(host.port);
    client.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === "request" && msg.method === "list_tabs") {
        client.send(JSON.stringify({ type: "response", id: msg.id, ok: true, result: { tabs: [] } }));
      }
    });
    const result = await host.request("list_tabs", {});
    expect(result).toEqual({ tabs: [] });
    client.close();
  });

  it("rejects a request when no client is paired", async () => {
    host = new BridgeHost({ port: 0, token: TOKEN });
    await host.start();
    await expect(host.request("list_tabs", {})).rejects.toThrow(/not connected/i);
  });

  it("rejects a request that times out", async () => {
    host = new BridgeHost({ port: 0, token: TOKEN });
    await host.start();
    const client = await connectClient(host.port);
    // client never replies
    await expect(host.request("list_tabs", {}, 100)).rejects.toThrow(/timed out/i);
    client.close();
  });

  it("stop() terminates a connected client", async () => {
    host = new BridgeHost({ port: 0, token: TOKEN });
    await host.start();
    const client = await connectClient(host.port);
    const closed = new Promise<void>((resolve, reject) => {
      client.on("close", () => resolve());
      setTimeout(() => reject(new Error("client did not close within 1000ms")), 1000);
    });
    await host.stop();
    await closed;
  });

  it("second authenticated client replaces and closes the first (code 4002)", async () => {
    host = new BridgeHost({ port: 0, token: TOKEN });
    await host.start();

    // Connect client A
    const clientA = await connectClient(host.port);
    const aClosedCode = new Promise<number>((resolve, reject) => {
      clientA.on("close", (code) => resolve(code));
      setTimeout(() => reject(new Error("client A did not close within 1000ms")), 1000);
    });

    // Connect client B and set up a reply handler
    const clientB = await connectClient(host.port);
    clientB.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === "request" && msg.method === "list_tabs") {
        clientB.send(JSON.stringify({ type: "response", id: msg.id, ok: true, result: { tabs: ["b"] } }));
      }
    });

    // A should have been closed with 4002
    const code = await aClosedCode;
    expect(code).toBe(4002);

    // B is the active paired client
    expect(host.paired).toBe(true);
    const result = await host.request("list_tabs", {});
    expect(result).toEqual({ tabs: ["b"] });

    clientB.close();
  });
});
