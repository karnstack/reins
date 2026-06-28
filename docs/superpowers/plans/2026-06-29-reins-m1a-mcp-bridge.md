# reins M1a — MCP-side Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the server half of the reins bridge: a token-authed localhost WebSocket host inside `reins-mcp` that an extension connects to, a request/response correlation layer, and a `list_tabs` MCP tool — all proven end-to-end in Node against a stand-in extension client (no browser needed).

**Architecture:** `reins-mcp` gains a `BridgeHost` (ws server on 127.0.0.1, origin + token auth, `hello`/`welcome` handshake, id-correlated request/response with timeout). `createServer` takes a `BridgePort` by dependency injection so tools call `bridge.request(method, params)`; `list_tabs` is the first such tool. Pairing material (token + port) persists in `~/.reins`. The real browser extension that speaks this protocol is M1b.

**Tech Stack:** TypeScript 6.0.3, @modelcontextprotocol/sdk 1.29.0, ws 8.21.0, zod 4.4.3 (via @reins/protocol), vitest 4.1.9, tsdown 0.22.3. Node 24.18.0 / pnpm 11.9.0 via mise.

## Global Constraints

- **Exact versions only** — no ^/~/latest. Run all tooling through `mise exec --` (Node 24.18.0, pnpm 11.9.0).
- **ESM everywhere** — `"type":"module"`, intra-repo relative imports use `.js` extensions, `verbatimModuleSyntax`.
- **Repo:** `~/code/karnstack/reins`, branch `feat/m1a-bridge`. Build libs with tsdown using `fixedExtension: false` (emit `.js`/`.d.ts`).
- **Bridge wire protocol (exact):** frames are JSON objects with a `type` discriminator. Extension→server: `hello` `{type:"hello",token,browser}`, `response` `{type:"response",id,ok,result?,error?}`. Server→extension: `welcome` `{type:"welcome",server}`, `request` `{type:"request",id,method,params}`. `error` is `{code:string,message:string}`.
- **Security (exact):** WS binds `127.0.0.1` only. Connections must present `Origin` starting with `chrome-extension://` (configurable prefix) → else close code `4003`. `hello.token` must equal the configured token → else close code `4001`. Token = 32 random bytes base64url. Default port `8765` (override via `REINS_PORT` env or explicit arg). Config dir `~/.reins`, token file mode `0o600`.
- **Request semantics:** default timeout `30000` ms; ids via `crypto.randomUUID()`; a request with no paired socket rejects immediately.
- All schemas live in `@reins/protocol`; `reins-mcp` imports them (this also compile-locks the package boundary the M0 review flagged as unexercised).

---

### Task 1: Bridge frame schemas in `@reins/protocol`

**Files:**
- Create: `packages/protocol/src/bridge.ts`, `packages/protocol/src/bridge.test.ts`
- Modify: `packages/protocol/src/index.ts` (add `export * from "./bridge.js"`)

**Interfaces:**
- Consumes: `zod` (already a dep).
- Produces: schemas `Tab`, `RequestFrame`, `ResponseFrame`, `WelcomeFrame`, `ListTabsResult` and their inferred types. Consumed by `reins-mcp` (Tasks 3–6) and the M1b extension.

- [ ] **Step 1: Write the failing test** — `packages/protocol/src/bridge.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { ListTabsResult, RequestFrame, ResponseFrame, Tab, WelcomeFrame } from "./bridge.js";

describe("bridge frames", () => {
  it("accepts a valid request frame", () => {
    const f = RequestFrame.parse({ type: "request", id: "abc", method: "list_tabs", params: {} });
    expect(f.method).toBe("list_tabs");
  });

  it("rejects a request frame with the wrong type literal", () => {
    expect(() => RequestFrame.parse({ type: "response", id: "abc", method: "x", params: {} })).toThrow();
  });

  it("accepts an ok response with a result", () => {
    const f = ResponseFrame.parse({ type: "response", id: "abc", ok: true, result: { tabs: [] } });
    expect(f.ok).toBe(true);
  });

  it("accepts a failed response with an error", () => {
    const f = ResponseFrame.parse({ type: "response", id: "abc", ok: false, error: { code: "E", message: "boom" } });
    expect(f.error?.code).toBe("E");
  });

  it("validates a Tab and a ListTabsResult", () => {
    const tab = Tab.parse({ tabId: 7, title: "t", url: "https://x", active: true });
    const res = ListTabsResult.parse({ tabs: [tab] });
    expect(res.tabs[0]?.tabId).toBe(7);
  });

  it("validates a welcome frame", () => {
    expect(WelcomeFrame.parse({ type: "welcome", server: "reins" }).server).toBe("reins");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `mise exec -- pnpm --filter @reins/protocol test`
Expected: FAIL — cannot resolve `./bridge.js`.

- [ ] **Step 3: Write the implementation** — `packages/protocol/src/bridge.ts`

```ts
import { z } from "zod";

/** A browser tab as seen by the agent. */
export const Tab = z.object({
  tabId: z.number(),
  title: z.string(),
  url: z.string(),
  active: z.boolean(),
});
export type Tab = z.infer<typeof Tab>;

/** Structured error carried by a failed response. */
export const FrameError = z.object({ code: z.string(), message: z.string() });
export type FrameError = z.infer<typeof FrameError>;

/** Server → extension: invoke a method on the browser. */
export const RequestFrame = z.object({
  type: z.literal("request"),
  id: z.string().min(1),
  method: z.string().min(1),
  params: z.unknown(),
});
export type RequestFrame = z.infer<typeof RequestFrame>;

/** Extension → server: result of a request. */
export const ResponseFrame = z.object({
  type: z.literal("response"),
  id: z.string().min(1),
  ok: z.boolean(),
  result: z.unknown().optional(),
  error: FrameError.optional(),
});
export type ResponseFrame = z.infer<typeof ResponseFrame>;

/** Server → extension: handshake acknowledgement. */
export const WelcomeFrame = z.object({
  type: z.literal("welcome"),
  server: z.string(),
});
export type WelcomeFrame = z.infer<typeof WelcomeFrame>;

/** Result payload for the `list_tabs` method. */
export const ListTabsResult = z.object({ tabs: z.array(Tab) });
export type ListTabsResult = z.infer<typeof ListTabsResult>;
```

- [ ] **Step 4: Update the barrel** — `packages/protocol/src/index.ts`

```ts
export * from "./frames.js";
export * from "./bridge.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `mise exec -- pnpm --filter @reins/protocol test`
Expected: PASS — all bridge tests + the existing HelloFrame tests.

- [ ] **Step 6: Build + typecheck**

Run: `mise exec -- pnpm --filter @reins/protocol build && mise exec -- pnpm --filter @reins/protocol typecheck`
Expected: emits `dist/index.js` + `.d.ts`; typecheck exits 0.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(protocol): bridge frame schemas (request/response/welcome/tab)"
```

---

### Task 2: Pairing config (`~/.reins` token + port) in `reins-mcp`

**Files:**
- Create: `packages/mcp/src/config.ts`, `packages/mcp/src/config.test.ts`

**Interfaces:**
- Consumes: Node `os`, `fs`, `path`, `crypto`.
- Produces: `loadOrCreateConfig(opts?: { home?: string; port?: number }): ReinsConfig` where `ReinsConfig = { dir: string; port: number; token: string }`. Token persists across calls; port defaults to `REINS_PORT` env or `8765`.

- [ ] **Step 1: Write the failing test** — `packages/mcp/src/config.test.ts`

```ts
import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadOrCreateConfig } from "./config.js";

const homes: string[] = [];
function freshHome(): string {
  const h = mkdtempSync(join(tmpdir(), "reins-home-"));
  homes.push(h);
  return h;
}
afterEach(() => {
  delete process.env.REINS_PORT;
});

describe("loadOrCreateConfig", () => {
  it("generates a token and persists it across calls", () => {
    const home = freshHome();
    const a = loadOrCreateConfig({ home });
    expect(a.token.length).toBeGreaterThanOrEqual(43);
    const b = loadOrCreateConfig({ home });
    expect(b.token).toBe(a.token);
  });

  it("writes the token file with 0600 permissions", () => {
    const home = freshHome();
    const c = loadOrCreateConfig({ home });
    const mode = statSync(join(c.dir, "token")).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("defaults the port to 8765 and honors an explicit port", () => {
    const home = freshHome();
    expect(loadOrCreateConfig({ home }).port).toBe(8765);
    expect(loadOrCreateConfig({ home, port: 9001 }).port).toBe(9001);
  });

  it("reads the port from REINS_PORT when no explicit port is given", () => {
    const home = freshHome();
    process.env.REINS_PORT = "9100";
    expect(loadOrCreateConfig({ home }).port).toBe(9100);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `mise exec -- pnpm --filter reins-mcp test config`
Expected: FAIL — cannot resolve `./config.js`.

- [ ] **Step 3: Write the implementation** — `packages/mcp/src/config.ts`

```ts
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface ReinsConfig {
  dir: string;
  port: number;
  token: string;
}

const DEFAULT_PORT = 8765;

function resolvePort(explicit?: number): number {
  if (typeof explicit === "number") return explicit;
  const env = process.env.REINS_PORT;
  if (env && Number.isInteger(Number(env))) return Number(env);
  return DEFAULT_PORT;
}

/** Load the reins config from ~/.reins, creating the dir and token if absent. */
export function loadOrCreateConfig(opts: { home?: string; port?: number } = {}): ReinsConfig {
  const dir = join(opts.home ?? homedir(), ".reins");
  mkdirSync(dir, { recursive: true });

  const tokenPath = join(dir, "token");
  let token: string;
  try {
    token = readFileSync(tokenPath, "utf8").trim();
    if (!token) throw new Error("empty token");
  } catch {
    token = randomBytes(32).toString("base64url");
    writeFileSync(tokenPath, token, { mode: 0o600 });
  }

  const port = resolvePort(opts.port);
  writeFileSync(join(dir, "port"), String(port), { mode: 0o600 });

  return { dir, port, token };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `mise exec -- pnpm --filter reins-mcp test config`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(mcp): ~/.reins pairing config (persistent token + port)"
```

---

### Task 3: `BridgeHost` — WebSocket auth + request/response

**Files:**
- Create: `packages/mcp/src/bridge.ts`, `packages/mcp/src/bridge.test.ts`

**Interfaces:**
- Consumes: `ws` (`WebSocketServer`, `WebSocket`), `node:crypto` (`randomUUID`), `@reins/protocol` (`RequestFrame`/`ResponseFrame` types).
- Produces:
  - `interface BridgePort { readonly paired: boolean; request(method: string, params: unknown, timeoutMs?: number): Promise<unknown>; }`
  - `class BridgeHost implements BridgePort` with `constructor(opts: { port: number; token: string; allowedOriginPrefix?: string })`, `start(): Promise<void>`, `stop(): Promise<void>`, `get port(): number` (the actually-bound port), `get paired(): boolean`, `request(...)`.

- [ ] **Step 1: Write the failing test** — `packages/mcp/src/bridge.test.ts`

```ts
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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `mise exec -- pnpm --filter reins-mcp test bridge`
Expected: FAIL — cannot resolve `./bridge.js`.

- [ ] **Step 3: Write the implementation** — `packages/mcp/src/bridge.ts`

```ts
import { randomUUID } from "node:crypto";
import { type AddressInfo } from "node:net";
import { type RawData, WebSocket, WebSocketServer } from "ws";

export interface BridgePort {
  readonly paired: boolean;
  request(method: string, params: unknown, timeoutMs?: number): Promise<unknown>;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: NodeJS.Timeout;
}

const DEFAULT_TIMEOUT_MS = 30_000;

export class BridgeHost implements BridgePort {
  readonly #token: string;
  readonly #originPrefix: string;
  readonly #requestedPort: number;
  #wss: WebSocketServer | undefined;
  #client: WebSocket | undefined;
  readonly #pending = new Map<string, Pending>();

  constructor(opts: { port: number; token: string; allowedOriginPrefix?: string }) {
    this.#requestedPort = opts.port;
    this.#token = opts.token;
    this.#originPrefix = opts.allowedOriginPrefix ?? "chrome-extension://";
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const wss = new WebSocketServer({ host: "127.0.0.1", port: this.#requestedPort });
      wss.on("listening", () => resolve());
      wss.on("error", reject);
      wss.on("connection", (ws, req) => this.#onConnection(ws, req.headers.origin));
      this.#wss = wss;
    });
  }

  get port(): number {
    const addr = this.#wss?.address();
    if (addr && typeof addr === "object") return (addr as AddressInfo).port;
    return this.#requestedPort;
  }

  get paired(): boolean {
    return this.#client !== undefined && this.#client.readyState === WebSocket.OPEN;
  }

  #onConnection(ws: WebSocket, origin: string | undefined): void {
    if (!origin || !origin.startsWith(this.#originPrefix)) {
      ws.close(4003, "origin not allowed");
      return;
    }
    let authed = false;
    ws.on("message", (data) => {
      const msg = this.#parse(data);
      if (!msg) return;
      if (!authed) {
        if (msg.type === "hello" && msg.token === this.#token) {
          authed = true;
          this.#client = ws;
          ws.send(JSON.stringify({ type: "welcome", server: "reins" }));
        } else {
          ws.close(4001, "bad token");
        }
        return;
      }
      if (msg.type === "response" && typeof msg.id === "string") {
        this.#settle(msg.id, msg);
      }
    });
    ws.on("close", () => {
      if (this.#client === ws) this.#client = undefined;
    });
  }

  #parse(data: RawData): Record<string, unknown> | undefined {
    try {
      const v = JSON.parse(data.toString());
      return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : undefined;
    } catch {
      return undefined;
    }
  }

  #settle(id: string, msg: Record<string, unknown>): void {
    const pending = this.#pending.get(id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.#pending.delete(id);
    if (msg.ok === true) {
      pending.resolve(msg.result);
    } else {
      const err = (msg.error ?? { code: "ERR", message: "request failed" }) as { code: string; message: string };
      pending.reject(new Error(`${err.code}: ${err.message}`));
    }
  }

  request(method: string, params: unknown, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<unknown> {
    const client = this.#client;
    if (!client || client.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("extension not connected"));
    }
    const id = randomUUID();
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`request "${method}" timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.#pending.set(id, { resolve, reject, timer });
      client.send(JSON.stringify({ type: "request", id, method, params }));
    });
  }

  stop(): Promise<void> {
    for (const [, pending] of this.#pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error("bridge stopped"));
    }
    this.#pending.clear();
    this.#client = undefined;
    const wss = this.#wss;
    this.#wss = undefined;
    if (!wss) return Promise.resolve();
    return new Promise((resolve) => wss.close(() => resolve()));
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `mise exec -- pnpm --filter reins-mcp test bridge`
Expected: PASS — 6 tests.

- [ ] **Step 5: Typecheck**

Run: `mise exec -- pnpm --filter reins-mcp typecheck`
Expected: exits 0.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(mcp): BridgeHost — ws auth handshake + request/response correlation"
```

---

### Task 4: `list_tabs` MCP tool + `createServer` dependency injection

**Files:**
- Modify: `packages/mcp/src/create-server.ts` (accept a `BridgePort`, add `list_tabs`)
- Modify: `packages/mcp/src/create-server.test.ts` (pass a fake bridge; add list_tabs tests)
- Modify: `packages/mcp/src/server.ts` (wire config + `BridgeHost` + `createServer`)

**Interfaces:**
- Consumes: `BridgePort` (Task 3), `ListTabsResult` (`@reins/protocol`), `loadOrCreateConfig` (Task 2).
- Produces: `createServer(bridge: BridgePort): McpServer` exposing `ping` + `list_tabs`.

- [ ] **Step 1: Update the test** — `packages/mcp/src/create-server.test.ts`

```ts
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
    const first = (result.content as Array<{ type: string; text?: string }>)[0]!;
    expect(first.text).toBe("pong");
    await client.close();
  });

  it("list_tabs returns the bridge's tabs as JSON", async () => {
    const tabs = [{ tabId: 1, title: "Home", url: "https://x", active: true }];
    const client = await connect(fakeBridge({ request: async () => ({ tabs }) }));
    const result = await client.callTool({ name: "list_tabs", arguments: {} });
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `mise exec -- pnpm --filter reins-mcp test create-server`
Expected: FAIL — `createServer` still takes no args / `list_tabs` not registered.

- [ ] **Step 3: Update the implementation** — `packages/mcp/src/create-server.ts`

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ListTabsResult } from "@reins/protocol";
import type { BridgePort } from "./bridge.js";

/** Build the reins MCP server, wired to a bridge that reaches the browser. */
export function createServer(bridge: BridgePort): McpServer {
  const server = new McpServer({ name: "reins", version: "0.0.0" });

  server.registerTool(
    "ping",
    { description: "Health check. Returns 'pong'.", inputSchema: {} },
    async () => ({ content: [{ type: "text", text: "pong" }] }),
  );

  server.registerTool(
    "list_tabs",
    { description: "List open browser tabs (id, title, url, active).", inputSchema: {} },
    async () => {
      if (!bridge.paired) {
        return {
          isError: true,
          content: [{ type: "text", text: "No browser connected. Run `reins pair` and connect the extension." }],
        };
      }
      const raw = await bridge.request("list_tabs", {});
      const { tabs } = ListTabsResult.parse(raw);
      return { content: [{ type: "text", text: JSON.stringify(tabs, null, 2) }] };
    },
  );

  return server;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `mise exec -- pnpm --filter reins-mcp test create-server`
Expected: PASS — 3 tests.

- [ ] **Step 5: Wire the stdio entrypoint** — `packages/mcp/src/server.ts`

```ts
#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { BridgeHost } from "./bridge.js";
import { loadOrCreateConfig } from "./config.js";
import { createServer } from "./create-server.js";

const config = loadOrCreateConfig();
const bridge = new BridgeHost({ port: config.port, token: config.token });
await bridge.start();

const server = createServer(bridge);
const transport = new StdioServerTransport();
await server.connect(transport);
```

- [ ] **Step 6: Build + typecheck + verify server boots**

Run:
```bash
mise exec -- pnpm --filter reins-mcp build
mise exec -- pnpm --filter reins-mcp typecheck
```
Expected: build emits `dist/{server,cli,create-server,bridge,config}.js`; typecheck exits 0.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(mcp): list_tabs tool + bridge-injected createServer + wired server.ts"
```

---

### Task 5: `reins` CLI — `pair`, `status`, `doctor`

**Files:**
- Create: `packages/mcp/src/cli-commands.ts`, `packages/mcp/src/cli-commands.test.ts`
- Modify: `packages/mcp/src/cli.ts` (dispatch to the command functions)

**Interfaces:**
- Consumes: `loadOrCreateConfig` (Task 2).
- Produces: `pairText(cfg): string`, `doctorReport(cfg): { checks: Array<{ name: string; ok: boolean; detail: string }>; ok: boolean }`. `cli.ts` formats and prints them.

- [ ] **Step 1: Write the failing test** — `packages/mcp/src/cli-commands.test.ts`

```ts
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadOrCreateConfig } from "./config.js";
import { doctorReport, pairText } from "./cli-commands.js";

function cfg() {
  return loadOrCreateConfig({ home: mkdtempSync(join(tmpdir(), "reins-cli-")) });
}

describe("pairText", () => {
  it("prints the ws url and token", () => {
    const c = cfg();
    const out = pairText(c);
    expect(out).toContain(`ws://127.0.0.1:${c.port}`);
    expect(out).toContain(c.token);
  });
});

describe("doctorReport", () => {
  it("passes its checks for a freshly created config", () => {
    const report = doctorReport(cfg());
    expect(report.ok).toBe(true);
    expect(report.checks.find((c) => c.name === "token")?.ok).toBe(true);
    expect(report.checks.find((c) => c.name === "port")?.ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `mise exec -- pnpm --filter reins-mcp test cli-commands`
Expected: FAIL — cannot resolve `./cli-commands.js`.

- [ ] **Step 3: Write the implementation** — `packages/mcp/src/cli-commands.ts`

```ts
import type { ReinsConfig } from "./config.js";

/** Human-readable pairing instructions for `reins pair`. */
export function pairText(cfg: ReinsConfig): string {
  return [
    "reins pairing",
    "",
    `  WebSocket URL : ws://127.0.0.1:${cfg.port}`,
    `  Token        : ${cfg.token}`,
    "",
    "Paste both into the reins extension popup to connect this browser.",
  ].join("\n");
}

export interface DoctorReport {
  checks: Array<{ name: string; ok: boolean; detail: string }>;
  ok: boolean;
}

/** Diagnostic checks for `reins doctor`. */
export function doctorReport(cfg: ReinsConfig): DoctorReport {
  const checks = [
    { name: "config-dir", ok: cfg.dir.length > 0, detail: cfg.dir },
    { name: "token", ok: cfg.token.length >= 43, detail: `${cfg.token.length} chars` },
    { name: "port", ok: Number.isInteger(cfg.port) && cfg.port > 0, detail: String(cfg.port) },
    { name: "node", ok: process.versions.node.length > 0, detail: `v${process.versions.node}` },
  ];
  return { checks, ok: checks.every((c) => c.ok) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `mise exec -- pnpm --filter reins-mcp test cli-commands`
Expected: PASS — 2 tests.

- [ ] **Step 5: Rewrite the CLI dispatcher** — `packages/mcp/src/cli.ts`

```ts
#!/usr/bin/env node
import { doctorReport, pairText } from "./cli-commands.js";
import { loadOrCreateConfig } from "./config.js";

const [command] = process.argv.slice(2);
const cfg = loadOrCreateConfig();

switch (command) {
  case "pair":
    console.log(pairText(cfg));
    break;
  case "doctor": {
    const report = doctorReport(cfg);
    for (const c of report.checks) {
      console.log(`${c.ok ? "✓" : "✗"} ${c.name}: ${c.detail}`);
    }
    console.log(report.ok ? "\nAll checks passed." : "\nSome checks failed.");
    process.exitCode = report.ok ? 0 : 1;
    break;
  }
  case "status":
    console.log(`config: ${cfg.dir}\nport: ${cfg.port}\nrun \`reins pair\` to connect a browser`);
    break;
  default:
    console.log("reins — usage: reins <pair|status|doctor>");
}
```

- [ ] **Step 6: Build + verify the CLI runs**

Run:
```bash
mise exec -- pnpm --filter reins-mcp build
mise exec -- node packages/mcp/dist/cli.js doctor
```
Expected: prints check lines ending "All checks passed." and exits 0.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(mcp): reins CLI pair/status/doctor"
```

---

### Task 6: End-to-end bridge integration test

**Files:**
- Create: `packages/mcp/src/integration.test.ts`

**Interfaces:**
- Consumes: `BridgeHost` (Task 3), `createServer` (Task 4), `ws`, MCP `Client` + `InMemoryTransport`.
- Produces: a test proving MCP `list_tabs` → BridgeHost → real WS → stand-in extension → response flows end-to-end.

- [ ] **Step 1: Write the test** — `packages/mcp/src/integration.test.ts`

```ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { WebSocket } from "ws";
import { afterEach, describe, expect, it } from "vitest";
import { BridgeHost } from "./bridge.js";
import { createServer } from "./create-server.js";

const TOKEN = "integration-token";
let host: BridgeHost | undefined;
let extension: WebSocket | undefined;

afterEach(async () => {
  extension?.close();
  await host?.stop();
  host = undefined;
  extension = undefined;
});

/** A stand-in extension: connects, authenticates, answers list_tabs. */
function standInExtension(port: number, tabs: unknown): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`, { headers: { origin: "chrome-extension://standin" } });
  return new Promise((resolve, reject) => {
    ws.on("open", () => ws.send(JSON.stringify({ type: "hello", token: TOKEN, browser: "standin" })));
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

    const server = createServer(host);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: "e2e", version: "0.0.0" });
    await client.connect(clientTransport);

    const result = await client.callTool({ name: "list_tabs", arguments: {} });
    const text = (result.content as Array<{ type: string; text?: string }>)[0]?.text ?? "";
    expect(JSON.parse(text)).toEqual(tabs);

    await client.close();
  });
});
```

- [ ] **Step 2: Run the test**

Run: `mise exec -- pnpm --filter reins-mcp test integration`
Expected: PASS — 1 test. The MCP call resolves with the tabs the stand-in extension returned.

- [ ] **Step 3: Full pipeline + commit**

Run: `mise exec -- pnpm lint && mise exec -- pnpm typecheck && mise exec -- pnpm test && mise exec -- pnpm build`
Expected: all green; mcp test count now covers config(4)+bridge(6)+create-server(3)+cli-commands(2)+integration(1) plus protocol bridge(6)+HelloFrame(3) and extension(2).

```bash
git add -A
git commit -m "test(mcp): end-to-end bridge integration (MCP -> ws -> extension)"
```

---

## Self-Review

**1. Spec coverage (design §11.2 M1, server half):** protocol bridge schemas → Task 1; `reins-mcp` WS host + pairing/token + origin check + hello/welcome → Tasks 2–3; bridge request/response + a tool returning live tab info → Task 4; `reins doctor`/pair → Task 5; end-to-end proof → Task 6. The browser-side offscreen WS client + popup are M1b (separate plan). The M0 review's "exercise `@reins/protocol` from a consumer" item is satisfied — Task 4 imports `ListTabsResult` from `@reins/protocol`, compile-locking the boundary.

**2. Placeholder scan:** No TBD/"add error handling"/"write tests for the above". Every step has complete code or an exact command + expected output. Error paths (bad token 4001, bad origin 4003, no-client, timeout, not-paired) are concrete with tests.

**3. Type consistency:** `BridgePort` defined in Task 3 (`paired`, `request(method, params, timeoutMs?)`) is consumed identically in Task 4's `createServer(bridge: BridgePort)` and fake. `BridgeHost` constructor `{ port, token, allowedOriginPrefix? }` and `get port()` used consistently in Tasks 3/6 tests. `loadOrCreateConfig({ home?, port? }): ReinsConfig{dir,port,token}` consistent across Tasks 2/5. Wire frames match the Global Constraints protocol exactly (`hello`/`welcome`/`request`/`response`). `ListTabsResult` shape (`{tabs: Tab[]}`) consistent in protocol + tool + tests.

## Notes for M1b (next plan)
- Real MV3 extension: offscreen document holds the WS client; worker ↔ offscreen via `chrome.runtime`; connect + `hello` using the token stored from the popup pairing form.
- Implement the `list_tabs` request handler in the extension via `chrome.tabs.query`, replying with `{type:"response", id, ok:true, result:{tabs}}`.
- Popup: pairing form (url + token → `chrome.storage.local`), connection indicator, kill switch.
- Real-browser e2e (Playwright loading the unpacked extension) validating the same `list_tabs` round trip against a real browser.
- Reconnect/backoff (using `nextBackoff`) and worker-death soak are M4 hardening, not M1b.
