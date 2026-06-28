import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createServer } from "./create-server.js";

describe("createServer", () => {
  it("exposes a ping tool that returns pong", async () => {
    const server = createServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    const client = new Client({ name: "test", version: "0.0.0" });
    await client.connect(clientTransport);

    const result = await client.callTool({ name: "ping", arguments: {} });
    const first = (result.content as Array<{ type: string; text?: string }>)[0]!;
    expect(first.text).toBe("pong");

    await client.close();
  });
});
