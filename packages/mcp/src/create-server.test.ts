import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import type { BridgePort } from "./bridge.js";
import { createServer } from "./create-server.js";

function fakeBridge(over: Partial<BridgePort> = {}): BridgePort {
  return {
    paired: true,
    request: async () => ({ tabs: [] }),
    ...over,
  };
}

async function connect(bridge: BridgePort): Promise<Client> {
  const server = createServer(bridge);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(clientTransport);
  return client;
}

describe("createServer", () => {
  it("exposes a ping tool that returns pong", async () => {
    const client = await connect(fakeBridge());
    const result = await client.callTool({ name: "ping", arguments: {} });
    // biome-ignore lint/style/noNonNullAssertion: tool result always has >=1 content item; TS noUncheckedIndexedAccess requires the assertion
    const first = (result.content as Array<{ type: string; text?: string }>)[0]!;
    expect(first.text).toBe("pong");
    await client.close();
  });

  it("list_tabs returns the bridge's tabs as JSON", async () => {
    const tabs = [{ tabId: 1, title: "Home", url: "https://x", active: true }];
    const client = await connect(fakeBridge({ request: async () => ({ tabs }) }));
    const result = await client.callTool({ name: "list_tabs", arguments: {} });
    // biome-ignore lint/style/noNonNullAssertion: tool result always has >=1 content item; TS noUncheckedIndexedAccess requires the assertion
    const first = (result.content as Array<{ type: string; text?: string }>)[0]!;
    expect(JSON.parse(first.text ?? "")).toEqual(tabs);
    await client.close();
  });

  it("list_tabs reports an error when no extension is paired", async () => {
    const client = await connect(fakeBridge({ paired: false }));
    const result = await client.callTool({ name: "list_tabs", arguments: {} });
    expect(result.isError).toBe(true);
    await client.close();
  });
});
