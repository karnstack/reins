import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { BridgeHost } from "./bridge.js";
import { startDaemon } from "./daemon.js";

const ORIGIN = "chrome-extension://standin";
let daemon: Awaited<ReturnType<typeof startDaemon>> | undefined;
let bridge: BridgeHost | undefined;
let extension: WebSocket | undefined;

afterEach(async () => {
  extension?.close();
  await daemon?.close();
  daemon = undefined;
  bridge = undefined;
  extension = undefined;
});

/** Lookup table: bridge method name → stand-in result the extension returns. */
const METHOD_RESULTS: Record<string, unknown> = {
  list_tabs: { tabs: [{ tabId: 1, title: "t", url: "https://a", active: true }] },
  open_tab: { tabId: 7 },
  close_tab: { ok: true },
  select_tab: { ok: true },
  navigate: { url: "https://example.com/" },
  read_snapshot: { content: "e1: button OK", refs: [{ ref: "e1", role: "button", name: "OK" }] },
  click: { ok: true },
  type: { ok: true },
  screenshot: { data: "aGVsbG8=", mimeType: "image/png" },
  eval_js: { value: { answer: 42 } },
  wait_for: { ok: true },
  read_console: { entries: [{ level: "error", text: "boom", timestamp: 1 }] },
  read_network: { entries: [{ method: "GET", url: "https://x", status: 200, timestamp: 1 }] },
  press_key: { ok: true },
  hover: { ok: true },
  scroll: { ok: true },
  fill: { ok: true },
  select_option: { ok: true },
  upload: { ok: true },
  read_text: { text: "page text" },
  resize: { ok: true },
  handle_dialog: { ok: true },
  cdp: { result: { frameId: "F1" } },
};

/** Stand-in extension: connects, authenticates, and answers any method via the lookup table. */
function standInExtension(port: number): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`, { headers: { origin: ORIGIN } });
  return new Promise((resolve, reject) => {
    ws.on("open", () => ws.send(JSON.stringify({ type: "hello", browser: "standin" })));
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

async function setupHarness(): Promise<number> {
  bridge = new BridgeHost({ allowedOrigins: new Set([ORIGIN]), log: () => {} });
  daemon = await startDaemon({ port: 0, bridge, log: () => {} });
  extension = await standInExtension(daemon.port);
  expect(bridge.paired).toBe(true);
  return daemon.port;
}

async function rpc(port: number, method: string, params?: Record<string, unknown>) {
  const res = await fetch(`http://127.0.0.1:${port}/rpc`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ method, params }),
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { result: unknown }).result;
}

interface TestCase {
  method: string;
  params?: Record<string, unknown>;
  expected: unknown;
}

const TABLE: TestCase[] = [
  {
    method: "list_tabs",
    expected: {
      tabs: [
        {
          tabId: 1,
          title: "t",
          url: "https://a",
          active: true,
          browserId: "b1",
          browser: "standin",
        },
      ],
    },
  },
  { method: "open_tab", params: { url: "https://x" }, expected: { tabId: 7 } },
  { method: "close_tab", params: { tabId: 1 }, expected: { ok: true } },
  { method: "select_tab", params: { tabId: 1 }, expected: { ok: true } },
  {
    method: "navigate",
    params: { to: "https://example.com" },
    expected: { url: "https://example.com/" },
  },
  {
    method: "read_snapshot",
    expected: { content: "e1: button OK", refs: [{ ref: "e1", role: "button", name: "OK" }] },
  },
  { method: "click", params: { ref: "e1" }, expected: { ok: true } },
  { method: "type", params: { ref: "e1", text: "hi" }, expected: { ok: true } },
  { method: "screenshot", expected: { data: "aGVsbG8=", mimeType: "image/png" } },
  { method: "eval_js", params: { expression: "1" }, expected: { value: { answer: 42 } } },
  { method: "wait_for", params: { ref: "e1" }, expected: { ok: true } },
  {
    method: "read_console",
    expected: { entries: [{ level: "error", text: "boom", timestamp: 1 }] },
  },
  {
    method: "read_network",
    expected: { entries: [{ method: "GET", url: "https://x", status: 200, timestamp: 1 }] },
  },
  { method: "press_key", params: { key: "Escape" }, expected: { ok: true } },
  { method: "hover", params: { ref: "e1" }, expected: { ok: true } },
  { method: "scroll", params: { to: "bottom" }, expected: { ok: true } },
  { method: "fill", params: { ref: "e1", value: "x" }, expected: { ok: true } },
  { method: "select_option", params: { ref: "e1", value: "IN" }, expected: { ok: true } },
  { method: "upload", params: { ref: "e1", files: ["/tmp/a.pdf"] }, expected: { ok: true } },
  { method: "read_text", expected: { text: "page text" } },
  { method: "resize", params: { width: 1280, height: 800 }, expected: { ok: true } },
  { method: "handle_dialog", params: { accept: true }, expected: { ok: true } },
  { method: "cdp", params: { method: "Page.enable" }, expected: { result: { frameId: "F1" } } },
];

describe("end-to-end /rpc → WS bridge", () => {
  it.each(TABLE)("routes $method end-to-end", async ({ method, params, expected }) => {
    const port = await setupHarness();
    expect(await rpc(port, method, params)).toEqual(expected);
  });
});
