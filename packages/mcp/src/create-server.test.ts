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

  it("navigate returns the resulting url", async () => {
    const client = await connect(
      fakeBridge({ request: async () => ({ url: "https://example.com/" }) }),
    );
    const result = await client.callTool({
      name: "navigate",
      arguments: { to: "https://example.com" },
    });
    const first = (result.content as Array<{ type: string; text?: string }>)[0];
    // biome-ignore lint/style/noNonNullAssertion: tool result always has >=1 content item
    expect(first!.text).toContain("https://example.com/");
    await client.close();
  });

  it("read_snapshot returns content and refs", async () => {
    const snap = { content: 'button "OK" [e1]', refs: [{ ref: "e1", role: "button", name: "OK" }] };
    const client = await connect(fakeBridge({ request: async () => snap }));
    const result = await client.callTool({ name: "read_snapshot", arguments: { mode: "a11y" } });
    const first = (result.content as Array<{ type: string; text?: string }>)[0];
    // biome-ignore lint/style/noNonNullAssertion: tool result always has >=1 content item
    expect(first!.text).toContain("e1");
    await client.close();
  });

  it("click returns ok", async () => {
    const client = await connect(fakeBridge({ request: async () => ({ ok: true }) }));
    const result = await client.callTool({ name: "click", arguments: { ref: "e1" } });
    expect(result.isError).toBeFalsy();
    await client.close();
  });

  it("type returns ok", async () => {
    const client = await connect(fakeBridge({ request: async () => ({ ok: true }) }));
    const result = await client.callTool({ name: "type", arguments: { ref: "e1", text: "hello" } });
    expect(result.isError).toBeFalsy();
    await client.close();
  });

  it("driving tools error when not paired", async () => {
    const client = await connect(fakeBridge({ paired: false }));
    const result = await client.callTool({ name: "navigate", arguments: { to: "https://x" } });
    expect(result.isError).toBe(true);
    await client.close();
  });

  it("open_tab returns 'Opened tab <tabId>'", async () => {
    const client = await connect(fakeBridge({ request: async () => ({ tabId: 99 }) }));
    const result = await client.callTool({
      name: "open_tab",
      arguments: { url: "https://example.com" },
    });
    // biome-ignore lint/style/noNonNullAssertion: tool result always has >=1 content item
    const first = (result.content as Array<{ type: string; text?: string }>)[0]!;
    expect(first.text).toBe("Opened tab 99");
    await client.close();
  });

  it("close_tab returns ok", async () => {
    const client = await connect(fakeBridge({ request: async () => ({ ok: true }) }));
    const result = await client.callTool({ name: "close_tab", arguments: { tabId: 5 } });
    expect(result.isError).toBeFalsy();
    // biome-ignore lint/style/noNonNullAssertion: tool result always has >=1 content item
    const first = (result.content as Array<{ type: string; text?: string }>)[0]!;
    expect(first.text).toBe("ok");
    await client.close();
  });

  it("select_tab returns ok", async () => {
    const client = await connect(fakeBridge({ request: async () => ({ ok: true }) }));
    const result = await client.callTool({ name: "select_tab", arguments: { tabId: 3 } });
    expect(result.isError).toBeFalsy();
    // biome-ignore lint/style/noNonNullAssertion: tool result always has >=1 content item
    const first = (result.content as Array<{ type: string; text?: string }>)[0]!;
    expect(first.text).toBe("ok");
    await client.close();
  });

  it("open_tab reports error when not paired", async () => {
    const client = await connect(fakeBridge({ paired: false }));
    const result = await client.callTool({ name: "open_tab", arguments: { url: "https://x" } });
    expect(result.isError).toBe(true);
    await client.close();
  });

  it("screenshot returns an image content block with data and mimeType", async () => {
    // "hello" base64-encoded — must be valid base64 since the MCP SDK validates it
    const validBase64 = "aGVsbG8=";
    const client = await connect(
      fakeBridge({ request: async () => ({ data: validBase64, mimeType: "image/png" }) }),
    );
    const result = await client.callTool({ name: "screenshot", arguments: {} });
    expect(result.isError).toBeFalsy();
    // biome-ignore lint/style/noNonNullAssertion: tool result always has >=1 content item
    const first = (result.content as Array<{ type: string; data?: string; mimeType?: string }>)[0]!;
    expect(first.type).toBe("image");
    expect(first.data).toBe(validBase64);
    expect(first.mimeType).toBe("image/png");
    await client.close();
  });

  it("screenshot reports error when not paired", async () => {
    const client = await connect(fakeBridge({ paired: false }));
    const result = await client.callTool({ name: "screenshot", arguments: {} });
    expect(result.isError).toBe(true);
    await client.close();
  });

  it("eval_js returns the JSON-stringified value", async () => {
    const client = await connect(fakeBridge({ request: async () => ({ value: { answer: 42 } }) }));
    const result = await client.callTool({
      name: "eval_js",
      arguments: { expression: "({ answer: 42 })" },
    });
    expect(result.isError).toBeFalsy();
    // biome-ignore lint/style/noNonNullAssertion: tool result always has >=1 content item
    const first = (result.content as Array<{ type: string; text?: string }>)[0]!;
    expect(JSON.parse(first.text ?? "")).toEqual({ answer: 42 });
    await client.close();
  });

  it("eval_js reports error when not paired", async () => {
    const client = await connect(fakeBridge({ paired: false }));
    const result = await client.callTool({ name: "eval_js", arguments: { expression: "1" } });
    expect(result.isError).toBe(true);
    await client.close();
  });

  it("wait_for returns ok", async () => {
    const client = await connect(fakeBridge({ request: async () => ({ ok: true }) }));
    const result = await client.callTool({
      name: "wait_for",
      arguments: { selector: "#btn" },
    });
    expect(result.isError).toBeFalsy();
    // biome-ignore lint/style/noNonNullAssertion: tool result always has >=1 content item
    const first = (result.content as Array<{ type: string; text?: string }>)[0]!;
    expect(first.text).toBe("ok");
    await client.close();
  });

  it("wait_for reports error when not paired", async () => {
    const client = await connect(fakeBridge({ paired: false }));
    const result = await client.callTool({ name: "wait_for", arguments: { selector: "#btn" } });
    expect(result.isError).toBe(true);
    await client.close();
  });

  it("read_console returns formatted lines", async () => {
    const client = await connect(
      fakeBridge({
        request: async () => ({ entries: [{ level: "error", text: "boom", timestamp: 1 }] }),
      }),
    );
    const result = await client.callTool({ name: "read_console", arguments: {} });
    // biome-ignore lint/style/noNonNullAssertion: tool result always has >=1 content item
    const first = (result.content as Array<{ type: string; text?: string }>)[0]!;
    expect(first.text).toContain("[error] boom");
    await client.close();
  });

  it("read_network returns formatted lines", async () => {
    const client = await connect(
      fakeBridge({
        request: async () => ({
          entries: [{ method: "GET", url: "https://x", status: 200, timestamp: 1 }],
        }),
      }),
    );
    const result = await client.callTool({ name: "read_network", arguments: {} });
    // biome-ignore lint/style/noNonNullAssertion: tool result always has >=1 content item
    const first = (result.content as Array<{ type: string; text?: string }>)[0]!;
    expect(first.text).toContain("GET https://x -> 200");
    await client.close();
  });

  it("read_console reports error when not paired", async () => {
    const client = await connect(fakeBridge({ paired: false }));
    const result = await client.callTool({ name: "read_console", arguments: {} });
    expect(result.isError).toBe(true);
    await client.close();
  });
});
