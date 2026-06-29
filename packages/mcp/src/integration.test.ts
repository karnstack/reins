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

/** Lookup table: bridge method name → stand-in result the extension returns. */
const METHOD_RESULTS: Record<string, unknown> = {
  list_tabs: { tabs: [{ tabId: 1, title: "t", url: "https://a", active: true }] },
  open_tab: { tabId: 7 },
  close_tab: { ok: true },
  select_tab: { ok: true },
  navigate: { url: "https://example.com/" },
  read_snapshot: {
    content: "button OK [e1]",
    refs: [{ ref: "e1", role: "button", name: "OK" }],
  },
  click: { ok: true },
  type: { ok: true },
  screenshot: { data: "aGVsbG8=", mimeType: "image/png" },
  eval_js: { value: { answer: 42 } },
  wait_for: { ok: true },
};

/** Stand-in extension: connects, authenticates, and answers any method via the lookup table. */
function standInExtension(port: number): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`, {
    headers: { origin: "chrome-extension://standin" },
  });
  return new Promise((resolve, reject) => {
    ws.on("open", () =>
      ws.send(JSON.stringify({ type: "hello", token: TOKEN, browser: "standin" })),
    );
    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString()) as { type: string; id?: string; method?: string };
      if (msg.type === "welcome") resolve(ws);
      if (msg.type === "request") {
        const result = METHOD_RESULTS[msg.method ?? ""];
        ws.send(JSON.stringify({ type: "response", id: msg.id, ok: true, result }));
      }
    });
    ws.on("error", reject);
  });
}

/** Wire up the full end-to-end harness; assigns module-level vars for afterEach teardown. */
async function setupHarness(): Promise<Client> {
  host = new BridgeHost({ port: 0, token: TOKEN });
  await host.start();
  extension = await standInExtension(host.port);
  expect(host.paired).toBe(true);
  server = createServer(host);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  client = new Client({ name: "e2e", version: "0.0.0" });
  await client.connect(clientTransport);
  return client;
}

type MaybeContent = Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
type ToolResult = Awaited<ReturnType<Client["callTool"]>>;

interface TestCase {
  label: string;
  tool: string;
  args: Record<string, unknown>;
  assert: (r: ToolResult) => void;
}

const TABLE: TestCase[] = [
  {
    label: "list_tabs",
    tool: "list_tabs",
    args: {},
    assert: (r) => {
      const text = (r.content as MaybeContent)[0]?.text ?? "";
      expect(JSON.parse(text)).toEqual([{ tabId: 1, title: "t", url: "https://a", active: true }]);
    },
  },
  {
    label: "open_tab",
    tool: "open_tab",
    args: { url: "https://x" },
    assert: (r) => {
      const text = (r.content as MaybeContent)[0]?.text ?? "";
      expect(text).toBe("Opened tab 7");
    },
  },
  {
    label: "close_tab",
    tool: "close_tab",
    args: { tabId: 1 },
    assert: (r) => expect(r.isError).toBeFalsy(),
  },
  {
    label: "select_tab",
    tool: "select_tab",
    args: { tabId: 1 },
    assert: (r) => expect(r.isError).toBeFalsy(),
  },
  {
    label: "navigate",
    tool: "navigate",
    args: { to: "https://example.com" },
    assert: (r) => {
      const text = (r.content as MaybeContent)[0]?.text ?? "";
      expect(text).toContain("https://example.com/");
    },
  },
  {
    label: "read_snapshot",
    tool: "read_snapshot",
    args: {},
    assert: (r) => {
      const text = (r.content as MaybeContent)[0]?.text ?? "";
      expect(text).toBe("e1: button OK");
    },
  },
  {
    label: "click",
    tool: "click",
    args: { ref: "e1" },
    assert: (r) => expect(r.isError).toBeFalsy(),
  },
  {
    label: "type",
    tool: "type",
    args: { ref: "e1", text: "hi" },
    assert: (r) => expect(r.isError).toBeFalsy(),
  },
  {
    label: "screenshot",
    tool: "screenshot",
    args: {},
    assert: (r) => {
      const img = (r.content as MaybeContent)[0];
      expect(img?.type).toBe("image");
      expect(img?.data).toBe("aGVsbG8=");
    },
  },
  {
    label: "eval_js",
    tool: "eval_js",
    args: { expression: "1" },
    assert: (r) => {
      const text = (r.content as MaybeContent)[0]?.text ?? "";
      expect(JSON.parse(text)).toEqual({ answer: 42 });
    },
  },
  {
    label: "wait_for",
    tool: "wait_for",
    args: { ref: "e1" },
    assert: (r) => expect(r.isError).toBeFalsy(),
  },
];

describe("end-to-end bridge", () => {
  it.each(TABLE)("routes $label through the WS bridge end-to-end", async ({
    tool,
    args,
    assert: check,
  }) => {
    const c = await setupHarness();
    const result = await c.callTool({ name: tool, arguments: args });
    check(result);
  });
});
