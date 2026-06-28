import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { BridgeHost } from "./bridge.js";
import { createServer } from "./create-server.js";

const TOKEN = "integration-token";
let host: BridgeHost | undefined;
let extension: WebSocket | undefined;
let server: ReturnType<typeof createServer> | undefined;
let client: Client | undefined;

afterEach(async () => {
  await client?.close();
  await server?.close();
  extension?.close();
  await host?.stop();
  client = undefined;
  server = undefined;
  host = undefined;
  extension = undefined;
});

/** A stand-in extension: connects, authenticates, answers list_tabs. */
function standInExtension(port: number, tabs: unknown): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`, {
    headers: { origin: "chrome-extension://standin" },
  });
  return new Promise((resolve, reject) => {
    ws.on("open", () =>
      ws.send(JSON.stringify({ type: "hello", token: TOKEN, browser: "standin" })),
    );
    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === "welcome") resolve(ws);
      if (msg.type === "request" && msg.method === "list_tabs") {
        ws.send(JSON.stringify({ type: "response", id: msg.id, ok: true, result: { tabs } }));
      }
    });
    ws.on("error", reject);
  });
}

describe("end-to-end bridge", () => {
  it("routes a list_tabs MCP call through the WS bridge to the extension", async () => {
    host = new BridgeHost({ port: 0, token: TOKEN });
    await host.start();

    const tabs = [{ tabId: 42, title: "Example", url: "https://example.com", active: true }];
    extension = await standInExtension(host.port, tabs);
    expect(host.paired).toBe(true);

    server = createServer(host);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    client = new Client({ name: "e2e", version: "0.0.0" });
    await client.connect(clientTransport);

    const result = await client.callTool({ name: "list_tabs", arguments: {} });
    const text = (result.content as Array<{ type: string; text?: string }>)[0]?.text ?? "";
    expect(JSON.parse(text)).toEqual(tabs);
  });
});
