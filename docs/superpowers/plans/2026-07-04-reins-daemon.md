# reins daemon (one CLI, HTTP transport, zero-touch pairing) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the per-client stdio spawn model with a single localhost daemon (`reins serve`) that serves streamable-HTTP MCP and the extension WebSocket on one port, managed by a launchd/systemd user service, with the extension auto-connecting via pinned extension-ID origins (no tokens).

**Architecture:** One Node process binds `127.0.0.1:8765`: `POST/GET/DELETE /mcp` (SDK `StreamableHTTPServerTransport`, one `McpServer` per session, DNS-rebinding protection), `GET /health`, and a WS `upgrade` handler feeding the existing `BridgeHost`. The bridge authenticates the extension by exact `chrome-extension://<id>` origin match against a built-in ID plus `~/.reins/allowed-extensions`. `reins serve --stdio` keeps the old stdio transport. Package renames to `@karnstack/reins`, single `reins` bin.

**Tech Stack:** TypeScript, `@modelcontextprotocol/sdk` (streamableHttp server + client transports), `ws`, zod v4, tsdown, vitest, launchd/systemd.

**Spec:** `docs/superpowers/specs/2026-07-04-reins-daemon-design.md`

## Global Constraints

- Bind `127.0.0.1` only; default port 8765; `REINS_PORT` overrides.
- No tokens anywhere: no bearer on `/mcp`, no pairing token on the WS. `~/.reins/token` is no longer read or written.
- WS origin check is **exact** ID match (`chrome-extension://<id>`), never prefix match.
- Package `@karnstack/reins` v0.2.0, single bin `reins`; `reins-mcp` bin and package name retired. Extension version 0.2.0.
- Node `>=20` for the published package; repo dev pins stay (Node 24.18.0, pnpm 11.9.0 via mise).
- Every commit: `pnpm lint && pnpm typecheck && pnpm test` green. Format with `pnpm format` before committing.
- Windows service management out of scope; stdio mode is the Windows path.

---

### Task 1: Protocol — remove the pairing token from HelloFrame

**Files:**
- Modify: `packages/protocol/src/frames.ts`
- Test: `packages/protocol/src/frames.test.ts`

**Interfaces:**
- Produces: `HelloFrame` = `{ type: "hello", browser: string }` (zod object, non-strict, so an old client still sending `token` parses fine and the field is ignored).

- [ ] **Step 1: Update the frame test**

In `packages/protocol/src/frames.test.ts`, replace any test constructing a hello with a `token` field. The suite must contain:

```ts
import { describe, expect, it } from "vitest";
import { HelloFrame } from "./frames.js";

describe("HelloFrame", () => {
  it("parses a tokenless hello", () => {
    const parsed = HelloFrame.safeParse({ type: "hello", browser: "chrome" });
    expect(parsed.success).toBe(true);
  });

  it("ignores a legacy token field (non-strict object)", () => {
    const parsed = HelloFrame.safeParse({ type: "hello", browser: "chrome", token: "old" });
    expect(parsed.success).toBe(true);
    expect((parsed.data as Record<string, unknown>).token).toBeUndefined();
  });

  it("rejects a missing browser", () => {
    expect(HelloFrame.safeParse({ type: "hello" }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify the new expectations fail**

Run: `pnpm --filter @reins/protocol test`
Expected: FAIL — current schema requires `token: z.string().min(1)`, so the tokenless hello test fails.

- [ ] **Step 3: Update the schema**

`packages/protocol/src/frames.ts`:

```ts
import { z } from "zod";

/** First frame the extension sends to the MCP server to identify itself.
 *  Authentication is the WS Origin header (exact extension-ID allowlist),
 *  not a token — see the 2026-07-04 daemon spec. */
export const HelloFrame = z.object({
  type: z.literal("hello"),
  browser: z.string(),
});
export type HelloFrame = z.infer<typeof HelloFrame>;
```

- [ ] **Step 4: Run protocol tests**

Run: `pnpm --filter @reins/protocol test`
Expected: PASS (mcp/extension packages will break — fixed in Tasks 2 and 8; run only the protocol filter here).

- [ ] **Step 5: Commit**

```bash
git add packages/protocol/src/frames.ts packages/protocol/src/frames.test.ts
git commit -m "feat(protocol)!: drop pairing token from HelloFrame"
```

---

### Task 2: BridgeHost — exact-origin allowlist + attach to an existing HTTP server

**Files:**
- Modify: `packages/mcp/src/bridge.ts`
- Test: `packages/mcp/src/bridge.test.ts`

**Interfaces:**
- Consumes: `HelloFrame` from Task 1.
- Produces:
  - `new BridgeHost({ allowedOrigins: Set<string>, log?: Log })` — origins are full strings like `"chrome-extension://abcdef"`.
  - `bridge.attach(server: http.Server): void` — serve WS upgrades on an HTTP server owned by the caller (daemon mode).
  - `bridge.listen(port: number): Promise<void>` — own a socket (stdio mode); replaces `start()`. `bridge.port` unchanged.
  - `bridge.paired`, `bridge.request(...)`, `bridge.stop()` unchanged. `stop()` does not close an attached caller-owned server.

- [ ] **Step 1: Rewrite the bridge tests for the new auth + attach**

Replace `packages/mcp/src/bridge.test.ts` contents. Key changes: `connectClient` no longer sends a token (hello is `{ type: "hello", browser: "test" }`); host construction becomes `new BridgeHost({ allowedOrigins: new Set(["chrome-extension://abcdef"]) })` + `await host.listen(0)`; the 4001 bad-token tests become origin tests; add an `attach()` test.

```ts
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

function connectClient(port: number, opts: { origin?: string } = {}): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`, {
    headers: { origin: opts.origin ?? ALLOWED },
  });
  return new Promise((resolve, reject) => {
    ws.on("open", () => ws.send(JSON.stringify({ type: "hello", browser: "test" })));
    ws.on("message", (data) => {
      if (JSON.parse(data.toString()).type === "welcome") resolve(ws);
    });
    ws.on("close", (code) => reject(new Error(`closed ${code}`)));
    ws.on("error", reject);
  });
}

function newHost() {
  return new BridgeHost({ allowedOrigins: new Set([ALLOWED]) });
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
  });

  it("rejects a web-page origin", async () => {
    host = newHost();
    await host.listen(0);
    await expect(connectClient(host.port, { origin: "https://evil.example" })).rejects.toThrow();
  });

  it("round-trips a request to the connected client", async () => {
    host = newHost();
    await host.listen(0);
    const client = await connectClient(host.port);
    client.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === "request" && msg.method === "list_tabs") {
        client.send(JSON.stringify({ type: "response", id: msg.id, ok: true, result: { tabs: [] } }));
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

  it("rejects in-flight requests when the client disconnects", async () => {
    host = newHost();
    await host.listen(0);
    const client = await connectClient(host.port);
    client.on("message", (data) => {
      if (JSON.parse(data.toString()).type === "request") client.close();
    });
    await expect(host.request("list_tabs", {}, 10_000)).rejects.toThrow(/disconnected/i);
  });

  it("second client replaces the first (code 4002)", async () => {
    host = newHost();
    await host.listen(0);
    const a = await connectClient(host.port);
    const aClosed = new Promise<number>((resolve) => a.on("close", resolve));
    const b = await connectClient(host.port);
    expect(await aClosed).toBe(4002);
    expect(host.paired).toBe(true);
    b.close();
  });

  it("listen() rejects on a busy port", async () => {
    host = newHost();
    await host.listen(0);
    const other = newHost();
    await expect(other.listen(host.port)).rejects.toThrow();
    await other.stop();
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
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter reins-mcp test -- bridge`
Expected: FAIL — constructor signature, `listen`, `attach` don't exist yet.

- [ ] **Step 3: Rework bridge.ts**

Changes to `packages/mcp/src/bridge.ts` (keep `#pending`, `#settle`, `#parse`, `request`, `#rejectAllPending` exactly as they are):

```ts
import { randomUUID } from "node:crypto";
import type { Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { HelloFrame, RequestFrame, ResponseFrame, WelcomeFrame } from "@reins/protocol";
import { type RawData, WebSocket, WebSocketServer } from "ws";
import type { Log } from "./log.js";

export interface BridgePort {
  readonly paired: boolean;
  request(method: string, params: unknown, timeoutMs?: number): Promise<unknown>;
}

// … Pending interface and DEFAULT_TIMEOUT_MS unchanged …

export class BridgeHost implements BridgePort {
  readonly #allowedOrigins: ReadonlySet<string>;
  readonly #log: Log;
  #wss: WebSocketServer | undefined;
  #ownServer = false;
  #client: WebSocket | undefined;
  readonly #pending = new Map<string, Pending>();

  constructor(opts: { allowedOrigins: ReadonlySet<string>; log?: Log }) {
    this.#allowedOrigins = opts.allowedOrigins;
    this.#log = opts.log ?? ((message) => process.stderr.write(`${message}\n`));
  }

  /** Own a socket (stdio mode): bind 127.0.0.1:port. */
  listen(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const wss = new WebSocketServer({ host: "127.0.0.1", port });
      wss.on("listening", () => {
        this.#log(`reins: bridge listening on 127.0.0.1:${this.port}`);
        resolve();
      });
      wss.on("error", (err) => {
        this.#wss = undefined;
        reject(err);
      });
      wss.on("connection", (ws, req) => this.#onConnection(ws, req.headers.origin));
      this.#wss = wss;
      this.#ownServer = true;
    });
  }

  /** Ride a caller-owned HTTP server (daemon mode). */
  attach(server: HttpServer): void {
    const wss = new WebSocketServer({ noServer: true });
    server.on("upgrade", (req, socket, head) => {
      if (!this.#originAllowed(req.headers.origin)) {
        this.#log(`reins: rejected upgrade: origin not allowed (${req.headers.origin})`);
        socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => this.#onConnection(ws, req.headers.origin));
    });
    this.#wss = wss;
    this.#ownServer = false;
  }

  #originAllowed(origin: string | undefined): boolean {
    return origin !== undefined && this.#allowedOrigins.has(origin);
  }

  get port(): number {
    const addr = this.#wss?.address();
    if (addr && typeof addr === "object") return (addr as AddressInfo).port;
    return 0;
  }

  // get paired() unchanged

  #onConnection(ws: WebSocket, origin: string | undefined): void {
    this.#log(`reins: connection from origin=${origin}`);
    if (!this.#originAllowed(origin)) {
      // listen() mode has no pre-upgrade gate, so enforce here too.
      this.#log(`reins: rejected: origin not allowed (${origin})`);
      ws.close(4003, "origin not allowed");
      return;
    }
    let helloed = false;
    ws.on("message", (data) => {
      const msg = this.#parse(data);
      if (!msg) return;
      if (!helloed) {
        const hello = HelloFrame.safeParse(msg);
        if (!hello.success) {
          this.#log("reins: rejected: malformed hello");
          ws.close(4001, "malformed hello");
          return;
        }
        helloed = true;
        if (this.#client && this.#client !== ws && this.#client.readyState === WebSocket.OPEN) {
          this.#log("reins: client replaced by new connection");
          this.#client.close(4002, "replaced by a new connection");
        }
        this.#client = ws;
        this.#log(`reins: browser connected (${hello.data.browser})`);
        ws.send(JSON.stringify(WelcomeFrame.parse({ type: "welcome", server: "reins" })));
        return;
      }
      const response = ResponseFrame.safeParse(msg);
      if (response.success) this.#settle(response.data.id, response.data);
    });
    ws.on("close", (code) => {
      this.#log(`reins: connection closed (code=${code})`);
      if (this.#client === ws) {
        this.#client = undefined;
        this.#rejectAllPending("extension disconnected");
      }
    });
  }

  stop(): Promise<void> {
    this.#rejectAllPending("bridge stopped");
    this.#client = undefined;
    const wss = this.#wss;
    this.#wss = undefined;
    if (!wss) return Promise.resolve();
    for (const ws of wss.clients) ws.terminate();
    if (!this.#ownServer) {
      wss.close();
      return Promise.resolve(); // caller owns the HTTP server
    }
    return new Promise((resolve) => wss.close(() => resolve()));
  }
}
```

Delete the `timingSafeEqual` import and `tokenMatches` helper — no token remains. `server.ts` still calls `bridge.start()`; leave it broken for now (Task 5 rewrites it) but keep the tree compiling by renaming its call to `listen(config.port)` and constructing with `allowedOrigins: new Set<string>()` temporarily is NOT needed — Task 5 lands in the same PR sequence; instead update `server.ts` minimally now:

In `packages/mcp/src/server.ts` replace the construction/start lines:

```ts
import { loadAllowedOrigins } from "./allowlist.js"; // Task 3 — for now use: new Set<string>()
```

Until Task 3 exists, use a placeholder in `server.ts`:

```ts
const bridge = new BridgeHost({ allowedOrigins: new Set<string>(), log });
// …
await bridge.listen(config.port);
```

(`config.token` becomes unused by the server; `loadOrCreateConfig` cleanup happens in Task 5.)

- [ ] **Step 4: Run mcp tests**

Run: `pnpm --filter reins-mcp test`
Expected: PASS (bridge suite green; create-server/integration suites unaffected because `BridgePort` is unchanged; `integration.test.ts` may construct BridgeHost — if it does, update its constructor/`listen` calls the same way as the bridge tests).

- [ ] **Step 5: Commit**

```bash
git add packages/mcp/src
git commit -m "feat(mcp)!: bridge auths by exact extension-ID origin; attach() rides the daemon's HTTP server"
```

---

### Task 3: Extension-ID allowlist (`~/.reins/allowed-extensions` + `reins allow`)

**Files:**
- Create: `packages/mcp/src/allowlist.ts`
- Test: `packages/mcp/src/allowlist.test.ts`

**Interfaces:**
- Produces:
  - `PUBLISHED_EXTENSION_IDS: readonly string[]` — `[]` until the store listing exists (PUBLISHING.md gains a "fill this in" step in Task 9).
  - `loadAllowedOrigins(dir: string): Set<string>` — built-ins + file ids, each mapped to `chrome-extension://<id>`.
  - `allowExtension(dir: string, id: string): void` — validate + append id (idempotent). Throws `Error("invalid extension id")` unless `/^[a-p]{32}$/` (Chrome ids are 32 chars of a–p).

- [ ] **Step 1: Write the failing tests**

`packages/mcp/src/allowlist.test.ts`:

```ts
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { allowExtension, loadAllowedOrigins } from "./allowlist.js";

const VALID_ID = "a".repeat(32);
const OTHER_ID = "b".repeat(32);

function dir() {
  return mkdtempSync(join(tmpdir(), "reins-allow-"));
}

describe("loadAllowedOrigins", () => {
  it("returns only built-ins when the file is absent", () => {
    const origins = loadAllowedOrigins(dir());
    for (const o of origins) expect(o).toMatch(/^chrome-extension:\/\//);
  });

  it("includes ids from allowed-extensions, skipping blanks and comments", () => {
    const d = dir();
    writeFileSync(join(d, "allowed-extensions"), `${VALID_ID}\n\n# comment\n${OTHER_ID}\n`);
    const origins = loadAllowedOrigins(d);
    expect(origins.has(`chrome-extension://${VALID_ID}`)).toBe(true);
    expect(origins.has(`chrome-extension://${OTHER_ID}`)).toBe(true);
    expect(origins.has("chrome-extension://# comment")).toBe(false);
  });
});

describe("allowExtension", () => {
  it("appends a valid id and is idempotent", () => {
    const d = dir();
    allowExtension(d, VALID_ID);
    allowExtension(d, VALID_ID);
    const content = readFileSync(join(d, "allowed-extensions"), "utf8");
    expect(content.match(new RegExp(VALID_ID, "g"))).toHaveLength(1);
    expect(loadAllowedOrigins(d).has(`chrome-extension://${VALID_ID}`)).toBe(true);
  });

  it("rejects malformed ids", () => {
    expect(() => allowExtension(dir(), "not-an-id")).toThrow(/invalid extension id/);
    expect(() => allowExtension(dir(), "z".repeat(32))).toThrow(/invalid extension id/);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter reins-mcp test -- allowlist`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement**

`packages/mcp/src/allowlist.ts`:

```ts
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Chrome Web Store id(s) of the published reins extension.
 *  Empty until the first store publish — docs/PUBLISHING.md has the step. */
export const PUBLISHED_EXTENSION_IDS: readonly string[] = [];

const ID_RE = /^[a-p]{32}$/;

function filePath(dir: string): string {
  return join(dir, "allowed-extensions");
}

/** All WS origins the bridge accepts: built-ins + ~/.reins/allowed-extensions. */
export function loadAllowedOrigins(dir: string): Set<string> {
  const ids = new Set(PUBLISHED_EXTENSION_IDS);
  try {
    for (const line of readFileSync(filePath(dir), "utf8").split("\n")) {
      const id = line.trim();
      if (ID_RE.test(id)) ids.add(id);
    }
  } catch {
    // no file — built-ins only
  }
  return new Set([...ids].map((id) => `chrome-extension://${id}`));
}

/** Add a dev/unpacked extension id (validated, idempotent). */
export function allowExtension(dir: string, id: string): void {
  if (!ID_RE.test(id)) throw new Error(`invalid extension id: ${id}`);
  mkdirSync(dir, { recursive: true });
  if (loadAllowedOrigins(dir).has(`chrome-extension://${id}`)) return;
  appendFileSync(filePath(dir), `${id}\n`);
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter reins-mcp test -- allowlist`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/mcp/src/allowlist.ts packages/mcp/src/allowlist.test.ts
git commit -m "feat(mcp): extension-ID allowlist (~/.reins/allowed-extensions)"
```

---

### Task 4: HTTP daemon — /health, /mcp streamable transport, session management

**Files:**
- Create: `packages/mcp/src/daemon.ts`
- Test: `packages/mcp/src/daemon.test.ts`

**Interfaces:**
- Consumes: `BridgeHost.attach(server)` (Task 2), `createServer(bridge)` (existing), `packageVersion()` (existing), `Log` (existing).
- Produces:
  - `startDaemon(opts: { port: number; bridge: BridgeHost; log: Log }): Promise<{ port: number; close(): Promise<void> }>` — binds `127.0.0.1:opts.port` (0 = ephemeral for tests), wires `/health`, `/mcp`, and `bridge.attach`.

- [ ] **Step 1: Write the failing integration tests**

`packages/mcp/src/daemon.test.ts` — uses the SDK's real HTTP client transport and a fake extension over WS:

```ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { BridgeHost } from "./bridge.js";
import { startDaemon } from "./daemon.js";

const ORIGIN = "chrome-extension://abcdef";
const silent = () => {};
let daemon: Awaited<ReturnType<typeof startDaemon>> | undefined;
let bridge: BridgeHost | undefined;

afterEach(async () => {
  await daemon?.close();
  daemon = undefined;
  bridge = undefined;
});

async function boot() {
  bridge = new BridgeHost({ allowedOrigins: new Set([ORIGIN]), log: silent });
  daemon = await startDaemon({ port: 0, bridge, log: silent });
  return daemon;
}

/** Fake extension: answers list_tabs with one tab. */
function fakeExtension(port: number): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`, { headers: { origin: ORIGIN } });
  return new Promise((resolve, reject) => {
    ws.on("open", () => ws.send(JSON.stringify({ type: "hello", browser: "test" })));
    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === "welcome") resolve(ws);
      if (msg.type === "request" && msg.method === "list_tabs") {
        ws.send(JSON.stringify({
          type: "response", id: msg.id, ok: true,
          result: { tabs: [{ tabId: 1, title: "t", url: "https://x", active: true }] },
        }));
      }
    });
    ws.on("error", reject);
  });
}

async function mcpClient(port: number): Promise<Client> {
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)),
  );
  return client;
}

describe("daemon", () => {
  it("GET /health reports version and paired state", async () => {
    const d = await boot();
    let res = await fetch(`http://127.0.0.1:${d.port}/health`);
    expect(res.status).toBe(200);
    let body = (await res.json()) as { ok: boolean; version: string; paired: boolean };
    expect(body.ok).toBe(true);
    expect(body.paired).toBe(false);

    const ext = await fakeExtension(d.port);
    res = await fetch(`http://127.0.0.1:${d.port}/health`);
    body = (await res.json()) as { ok: boolean; version: string; paired: boolean };
    expect(body.paired).toBe(true);
    ext.close();
  });

  it("serves a full MCP session over streamable HTTP (initialize → tools/list → list_tabs)", async () => {
    const d = await boot();
    const ext = await fakeExtension(d.port);
    const client = await mcpClient(d.port);
    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name)).toContain("list_tabs");
    const result = await client.callTool({ name: "list_tabs", arguments: {} });
    expect(JSON.stringify(result.content)).toContain("https://x");
    await client.close();
    ext.close();
  });

  it("supports two concurrent MCP sessions sharing one bridge", async () => {
    const d = await boot();
    const ext = await fakeExtension(d.port);
    const [a, b] = await Promise.all([mcpClient(d.port), mcpClient(d.port)]);
    const [ra, rb] = await Promise.all([
      a.callTool({ name: "list_tabs", arguments: {} }),
      b.callTool({ name: "list_tabs", arguments: {} }),
    ]);
    expect(JSON.stringify(ra.content)).toContain("https://x");
    expect(JSON.stringify(rb.content)).toContain("https://x");
    await Promise.all([a.close(), b.close()]);
    ext.close();
  });

  it("rejects /mcp requests with a foreign Host header (DNS rebinding)", async () => {
    const d = await boot();
    const res = await fetch(`http://127.0.0.1:${d.port}/mcp`, {
      method: "POST",
      headers: {
        host: "evil.example",
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("404s unknown paths", async () => {
    const d = await boot();
    const res = await fetch(`http://127.0.0.1:${d.port}/nope`);
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter reins-mcp test -- daemon`
Expected: FAIL — `./daemon.js` doesn't exist.

- [ ] **Step 3: Implement daemon.ts**

```ts
import { randomUUID } from "node:crypto";
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { BridgeHost } from "./bridge.js";
import { createServer } from "./create-server.js";
import type { Log } from "./log.js";
import { packageVersion } from "./version.js";

export interface Daemon {
  port: number;
  close(): Promise<void>;
}

/** One HTTP server: /mcp (streamable, session per client), /health, WS upgrade → bridge. */
export async function startDaemon(opts: {
  port: number;
  bridge: BridgeHost;
  log: Log;
}): Promise<Daemon> {
  const sessions = new Map<string, StreamableHTTPServerTransport>();

  const httpServer = createHttpServer((req, res) => {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    if (path === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, version: packageVersion(), paired: opts.bridge.paired }));
      return;
    }
    if (path === "/mcp") {
      void handleMcp(req, res).catch((err) => {
        opts.log(`reins: /mcp error: ${err instanceof Error ? err.message : String(err)}`);
        if (!res.headersSent) res.writeHead(500).end();
      });
      return;
    }
    res.writeHead(404).end();
  });

  async function handleMcp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const sessionId = req.headers["mcp-session-id"];
    const existing = typeof sessionId === "string" ? sessions.get(sessionId) : undefined;
    if (existing) {
      await existing.handleRequest(req, res);
      return;
    }
    if (req.method !== "POST") {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "unknown or missing mcp-session-id" }));
      return;
    }
    // New session: the SDK validates that the first POST is an initialize.
    const port = actualPort();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      enableDnsRebindingProtection: true,
      allowedHosts: [`127.0.0.1:${port}`, `localhost:${port}`],
      onsessioninitialized: (sid) => {
        sessions.set(sid, transport);
        opts.log(`reins: mcp session opened (${sid})`);
      },
    });
    transport.onclose = () => {
      if (transport.sessionId && sessions.delete(transport.sessionId)) {
        opts.log(`reins: mcp session closed (${transport.sessionId})`);
      }
    };
    const server = createServer(opts.bridge);
    await server.connect(transport);
    await transport.handleRequest(req, res);
  }

  function actualPort(): number {
    const addr = httpServer.address();
    return addr && typeof addr === "object" ? addr.port : opts.port;
  }

  opts.bridge.attach(httpServer);

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(opts.port, "127.0.0.1", resolve);
  });
  opts.log(`reins: daemon listening on http://127.0.0.1:${actualPort()} (mcp: /mcp)`);

  return {
    port: actualPort(),
    close: async () => {
      for (const t of sessions.values()) await t.close().catch(() => {});
      sessions.clear();
      await opts.bridge.stop();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    },
  };
}
```

Note for the implementer: with `port: 0` the `allowedHosts` computed at transport-creation time uses the *actual* bound port via `actualPort()` — that is why hosts are computed inside `handleMcp`, after listen. Do not hoist.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter reins-mcp test -- daemon`
Expected: PASS (5 tests). If `handleRequest` complains about a missing parsed body, pass the raw request straight through — the SDK reads the node stream itself; do not add a body parser.

- [ ] **Step 5: Commit**

```bash
git add packages/mcp/src/daemon.ts packages/mcp/src/daemon.test.ts
git commit -m "feat(mcp): streamable-HTTP daemon with per-session MCP servers and shared bridge"
```

---

### Task 5: `serve` command — HTTP daemon foreground + `--stdio` fallback; retire token config

**Files:**
- Create: `packages/mcp/src/serve.ts`
- Modify: `packages/mcp/src/config.ts`, `packages/mcp/src/config.test.ts`
- Delete: `packages/mcp/src/server.ts` (its stdio logic moves into serve.ts)
- Modify: `packages/mcp/tsdown.config.ts` (entry list: replace `src/server.ts` with `src/serve.ts`; keep cli/create-server/bridge/config)

**Interfaces:**
- Consumes: `startDaemon` (Task 4), `BridgeHost` (Task 2), `loadAllowedOrigins` (Task 3), `createLogger`/`logsDir` (existing).
- Produces:
  - `runServe(opts: { stdio: boolean }): Promise<void>` — called by the CLI (Task 6). HTTP mode: daemon + SIGINT/SIGTERM shutdown. stdio mode: today's server.ts behavior (bridge on `listen(port)`, stdio transport, exit on stdin close).
  - `loadOrCreateConfig` drops the token entirely: returns `{ dir, port }`; no longer writes `~/.reins/token`.

- [ ] **Step 1: Update config tests for tokenless config**

In `packages/mcp/src/config.test.ts`: delete/replace all assertions about `token` (creation, 0600 mode, reuse). Keep/ensure:

```ts
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadOrCreateConfig } from "./config.js";

describe("loadOrCreateConfig", () => {
  it("creates ~/.reins and records the port", () => {
    const home = mkdtempSync(join(tmpdir(), "reins-home-"));
    const cfg = loadOrCreateConfig({ home });
    expect(cfg.dir).toBe(join(home, ".reins"));
    expect(cfg.port).toBe(8765);
    expect(readFileSync(join(cfg.dir, "port"), "utf8")).toBe("8765");
  });

  it("does not create a token file", () => {
    const home = mkdtempSync(join(tmpdir(), "reins-home-"));
    const cfg = loadOrCreateConfig({ home });
    expect(existsSync(join(cfg.dir, "token"))).toBe(false);
  });

  it("honors an explicit port", () => {
    const home = mkdtempSync(join(tmpdir(), "reins-home-"));
    expect(loadOrCreateConfig({ home, port: 9999 }).port).toBe(9999);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter reins-mcp test -- config`
Expected: FAIL — token file still created / token field still returned.

- [ ] **Step 3: Slim config.ts, write serve.ts, delete server.ts**

`packages/mcp/src/config.ts` becomes:

```ts
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface ReinsConfig {
  dir: string;
  port: number;
}

const DEFAULT_PORT = 8765;

function resolvePort(explicit?: number): number {
  if (typeof explicit === "number") return explicit;
  const env = process.env.REINS_PORT;
  if (env && Number.isInteger(Number(env))) return Number(env);
  return DEFAULT_PORT;
}

/** Load the reins config from ~/.reins, creating the dir if absent. */
export function loadOrCreateConfig(opts: { home?: string; port?: number } = {}): ReinsConfig {
  const dir = join(opts.home ?? homedir(), ".reins");
  mkdirSync(dir, { recursive: true });
  const port = resolvePort(opts.port);
  writeFileSync(join(dir, "port"), String(port));
  return { dir, port };
}
```

`packages/mcp/src/serve.ts` (server.ts's shutdown pattern, generalized):

```ts
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadAllowedOrigins } from "./allowlist.js";
import { BridgeHost } from "./bridge.js";
import { loadOrCreateConfig } from "./config.js";
import { createServer } from "./create-server.js";
import { startDaemon } from "./daemon.js";
import { createLogger } from "./log.js";

/** `reins serve` (HTTP daemon) / `reins serve --stdio` (per-client stdio). */
export async function runServe(opts: { stdio: boolean }): Promise<void> {
  const log = createLogger();
  const config = loadOrCreateConfig();
  const bridge = new BridgeHost({ allowedOrigins: loadAllowedOrigins(config.dir), log });

  let shuttingDown = false;
  const shutdown = async (reason: string, cleanup: () => Promise<void>) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`reins: shutting down (${reason})`);
    await cleanup().catch(() => {});
    process.exit(0);
  };

  if (!opts.stdio) {
    let daemon: Awaited<ReturnType<typeof startDaemon>>;
    try {
      daemon = await startDaemon({ port: config.port, bridge, log });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log(
        `reins: failed to start on port ${config.port}: ${msg}. Another reins daemon may already be running (reins status; REINS_PORT overrides the port).`,
      );
      process.exit(1);
    }
    process.on("SIGINT", () => void shutdown("SIGINT", () => daemon.close()));
    process.on("SIGTERM", () => void shutdown("SIGTERM", () => daemon.close()));
    return;
  }

  // stdio mode: bridge owns the port; server lives and dies with the client.
  try {
    await bridge.listen(config.port);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(
      `reins: failed to start bridge on port ${config.port}: ${msg}. Is the reins daemon running? stdio mode and the daemon cannot share a port (REINS_PORT overrides).`,
    );
    process.exit(1);
  }
  const server = createServer(bridge);
  const transport = new StdioServerTransport();
  const cleanup = async () => {
    await bridge.stop().catch(() => {});
    await server.close().catch(() => {});
  };
  server.server.onclose = () => void shutdown("client closed the session", cleanup);
  process.stdin.on("end", () => void shutdown("stdin closed", cleanup));
  process.stdin.on("close", () => void shutdown("stdin closed", cleanup));
  process.on("SIGINT", () => void shutdown("SIGINT", cleanup));
  process.on("SIGTERM", () => void shutdown("SIGTERM", cleanup));
  await server.connect(transport);
  log("reins: MCP server ready (stdio)");
}
```

Delete `packages/mcp/src/server.ts`. In `packages/mcp/tsdown.config.ts` set:

```ts
entry: ["src/serve.ts", "src/cli.ts", "src/create-server.ts", "src/bridge.ts", "src/config.ts"],
```

Temporarily point the CLI at it so the tree runs (full CLI rework is Task 6): in `packages/mcp/src/cli.ts` add a case:

```ts
case "serve": {
  const { runServe } = await import("./serve.js");
  await runServe({ stdio: rest.includes("--stdio") });
  break;
}
```

and remove the now-broken `pairText(...)` usage if `cfg.token` no longer exists — change `pair` to print a deprecation line for now (Task 6 deletes it):

```ts
case "pair":
  console.log("`reins pair` is gone — the extension auto-connects. See `reins help`.");
  break;
```

Update `packages/mcp/src/cli-commands.ts`: delete `pairText` (and its test in `cli-commands.test.ts`); in `doctorReport` drop the token check line.

- [ ] **Step 4: Full package check**

Run: `pnpm --filter reins-mcp build && pnpm --filter reins-mcp test && pnpm --filter reins-mcp typecheck`
Expected: PASS. Then manual smoke:

Run: `REINS_PORT=18999 node packages/mcp/dist/cli.js serve & sleep 1 && curl -s http://127.0.0.1:18999/health && kill %1`
Expected: `{"ok":true,"version":"0.1.0","paired":false}`

- [ ] **Step 5: Commit**

```bash
git add -A packages/mcp
git commit -m "feat(mcp)!: reins serve runs the HTTP daemon (--stdio keeps the old transport); config drops the token"
```

---

### Task 6: Service management (`reins up|down|restart`) — launchd + systemd

**Files:**
- Create: `packages/mcp/src/service.ts`
- Test: `packages/mcp/src/service.test.ts`

**Interfaces:**
- Consumes: `logsDir()` (existing).
- Produces:
  - `launchdPlist(opts: { node: string; cliJs: string; logsDir: string }): string`
  - `systemdUnit(opts: { node: string; cliJs: string }): string`
  - `servicePaths(platform: NodeJS.Platform, home: string): { path: string; kind: "launchd" | "systemd" } | undefined` — darwin → `<home>/Library/LaunchAgents/com.karnstack.reins.plist`; linux → `<home>/.config/systemd/user/reins.service`; anything else → undefined.
  - `serviceUp(): Promise<void>` / `serviceDown(): Promise<void>` / `serviceRestart(): Promise<void>` — write/remove the file and shell out (`launchctl bootout`+`bootstrap gui/<uid>`, or `systemctl --user daemon-reload` + `enable --now` / `disable --now`). On unsupported platforms they throw `Error("service management is not supported on <platform>; run \`reins serve\` in the foreground or use --stdio")`.

- [ ] **Step 1: Write failing tests for the pure parts**

`packages/mcp/src/service.test.ts` (generation + path selection only — no `launchctl`/`systemctl` execution in CI):

```ts
import { describe, expect, it } from "vitest";
import { launchdPlist, servicePaths, systemdUnit } from "./service.js";

const OPTS = { node: "/usr/local/bin/node", cliJs: "/x/dist/cli.js", logsDir: "/home/u/.reins/logs" };

describe("launchdPlist", () => {
  it("runs `node cli.js serve`, keeps alive, and captures stderr", () => {
    const plist = launchdPlist(OPTS);
    expect(plist).toContain("<string>/usr/local/bin/node</string>");
    expect(plist).toContain("<string>/x/dist/cli.js</string>");
    expect(plist).toContain("<string>serve</string>");
    expect(plist).toContain("com.karnstack.reins");
    expect(plist).toContain("<key>KeepAlive</key>");
    expect(plist).toContain("/home/u/.reins/logs/daemon.err.log");
  });
});

describe("systemdUnit", () => {
  it("execs `node cli.js serve` and restarts on failure", () => {
    const unit = systemdUnit(OPTS);
    expect(unit).toContain("ExecStart=/usr/local/bin/node /x/dist/cli.js serve");
    expect(unit).toContain("Restart=on-failure");
    expect(unit).toContain("WantedBy=default.target");
  });
});

describe("servicePaths", () => {
  it("darwin → LaunchAgents plist", () => {
    expect(servicePaths("darwin", "/Users/u")).toEqual({
      path: "/Users/u/Library/LaunchAgents/com.karnstack.reins.plist",
      kind: "launchd",
    });
  });
  it("linux → systemd user unit", () => {
    expect(servicePaths("linux", "/home/u")).toEqual({
      path: "/home/u/.config/systemd/user/reins.service",
      kind: "systemd",
    });
  });
  it("win32 → undefined", () => {
    expect(servicePaths("win32", "C:\\Users\\u")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter reins-mcp test -- service`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement service.ts**

```ts
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { logsDir } from "./log.js";

const LABEL = "com.karnstack.reins";

export function launchdPlist(opts: { node: string; cliJs: string; logsDir: string }): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${opts.node}</string>
    <string>${opts.cliJs}</string>
    <string>serve</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${opts.logsDir}/daemon.out.log</string>
  <key>StandardErrorPath</key><string>${opts.logsDir}/daemon.err.log</string>
</dict>
</plist>
`;
}

export function systemdUnit(opts: { node: string; cliJs: string }): string {
  return `[Unit]
Description=reins MCP daemon

[Service]
ExecStart=${opts.node} ${opts.cliJs} serve
Restart=on-failure

[Install]
WantedBy=default.target
`;
}

export function servicePaths(
  platform: NodeJS.Platform,
  home: string,
): { path: string; kind: "launchd" | "systemd" } | undefined {
  if (platform === "darwin") {
    return { path: join(home, "Library", "LaunchAgents", `${LABEL}.plist`), kind: "launchd" };
  }
  if (platform === "linux") {
    return { path: join(home, ".config", "systemd", "user", "reins.service"), kind: "systemd" };
  }
  return undefined;
}

function target() {
  const svc = servicePaths(process.platform, homedir());
  if (!svc) {
    throw new Error(
      `service management is not supported on ${process.platform}; run \`reins serve\` in the foreground or use --stdio`,
    );
  }
  return svc;
}

function cliJsPath(): string {
  // This module lands in dist/ next to cli.js after bundling.
  return join(dirname(fileURLToPath(import.meta.url)), "cli.js");
}

export async function serviceUp(): Promise<void> {
  const svc = target();
  const opts = { node: process.execPath, cliJs: cliJsPath(), logsDir: logsDir() };
  mkdirSync(dirname(svc.path), { recursive: true });
  mkdirSync(opts.logsDir, { recursive: true });
  if (svc.kind === "launchd") {
    writeFileSync(svc.path, launchdPlist(opts));
    const domain = `gui/${process.getuid?.() ?? 501}`;
    try {
      execFileSync("launchctl", ["bootout", domain, svc.path], { stdio: "ignore" });
    } catch {
      // not loaded — fine
    }
    execFileSync("launchctl", ["bootstrap", domain, svc.path], { stdio: "inherit" });
  } else {
    writeFileSync(svc.path, systemdUnit(opts));
    execFileSync("systemctl", ["--user", "daemon-reload"], { stdio: "inherit" });
    execFileSync("systemctl", ["--user", "enable", "--now", "reins"], { stdio: "inherit" });
  }
}

export async function serviceDown(): Promise<void> {
  const svc = target();
  if (svc.kind === "launchd") {
    const domain = `gui/${process.getuid?.() ?? 501}`;
    try {
      execFileSync("launchctl", ["bootout", domain, svc.path], { stdio: "ignore" });
    } catch {
      // not loaded
    }
  } else {
    try {
      execFileSync("systemctl", ["--user", "disable", "--now", "reins"], { stdio: "ignore" });
    } catch {
      // not enabled
    }
  }
  rmSync(svc.path, { force: true });
}

export async function serviceRestart(): Promise<void> {
  await serviceDown();
  await serviceUp();
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter reins-mcp test -- service`
Expected: PASS (3 describe blocks).

- [ ] **Step 5: Commit**

```bash
git add packages/mcp/src/service.ts packages/mcp/src/service.test.ts
git commit -m "feat(mcp): launchd/systemd user-service management for the daemon"
```

---

### Task 7: CLI surface — up/down/restart/serve/install/allow/status/doctor/logs

**Files:**
- Modify: `packages/mcp/src/cli.ts`, `packages/mcp/src/cli-commands.ts`
- Test: `packages/mcp/src/cli-commands.test.ts`

**Interfaces:**
- Consumes: `runServe` (Task 5), `serviceUp/Down/Restart` (Task 6), `allowExtension` (Task 3), `logsInfo`/`logsDir` (existing), `packageVersion` (existing).
- Produces (in cli-commands.ts, pure):
  - `claudeInstallArgs(port: number): string[]` → `["mcp","add","--transport","http","reins",`http://127.0.0.1:${port}/mcp`,"--scope","user"]`
  - `codexSnippet(port: number): string` → TOML with `url = "http://127.0.0.1:<port>/mcp"` plus a commented stdio fallback.
  - `mcpJsonSnippet(port: number): string` → `{ mcpServers: { reins: { type: "http", url } } }`
  - `installText(port: number): string`, `helpText(version: string): string` (lists up/down/restart/serve/install/allow/status/doctor/logs; no pair).
  - `healthSummary(h: { ok: boolean; version: string; paired: boolean } | undefined, port: number): string` — human status lines for `reins status`.

- [ ] **Step 1: Update cli-commands tests**

In `packages/mcp/src/cli-commands.test.ts`: delete the `pairText` describe block; update install-snippet tests to the HTTP shapes; add `healthSummary`:

```ts
describe("install snippets", () => {
  it("claudeInstallArgs registers the HTTP endpoint at user scope", () => {
    const args = claudeInstallArgs(8765);
    expect(args.join(" ")).toBe(
      "mcp add --transport http reins http://127.0.0.1:8765/mcp --scope user",
    );
  });

  it("codexSnippet points at the /mcp URL and mentions the stdio fallback", () => {
    expect(codexSnippet(8765)).toContain("http://127.0.0.1:8765/mcp");
    expect(codexSnippet(8765)).toContain("serve --stdio");
  });

  it("mcpJsonSnippet parses and targets /mcp", () => {
    const parsed = JSON.parse(mcpJsonSnippet(8765)) as {
      mcpServers: { reins: { type: string; url: string } };
    };
    expect(parsed.mcpServers.reins.url).toBe("http://127.0.0.1:8765/mcp");
  });
});

describe("healthSummary", () => {
  it("reports a running daemon", () => {
    const s = healthSummary({ ok: true, version: "0.2.0", paired: true }, 8765);
    expect(s).toContain("running");
    expect(s).toContain("0.2.0");
    expect(s).toContain("browser connected");
  });
  it("reports a stopped daemon with the fix", () => {
    const s = healthSummary(undefined, 8765);
    expect(s).toContain("not running");
    expect(s).toContain("reins up");
  });
});
```

Also update the `helpText` test's command list to `["up", "down", "serve", "install", "allow", "status", "doctor", "logs"]`.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter reins-mcp test -- cli-commands`
Expected: FAIL.

- [ ] **Step 3: Implement**

`cli-commands.ts` — replace the old snippet trio + add `healthSummary`; keep `doctorReport` (tokenless), `logsInfo`:

```ts
export function claudeInstallArgs(port: number): string[] {
  return ["mcp", "add", "--transport", "http", "reins", `http://127.0.0.1:${port}/mcp`, "--scope", "user"];
}

export function codexSnippet(port: number): string {
  return [
    "[mcp_servers.reins]",
    `url = "http://127.0.0.1:${port}/mcp"`,
    "",
    "# no HTTP support in your client? use stdio instead:",
    "# [mcp_servers.reins]",
    '# command = "npx"',
    `# args = ["-y", "@karnstack/reins", "serve", "--stdio"]`,
  ].join("\n");
}

export function mcpJsonSnippet(port: number): string {
  return JSON.stringify(
    { mcpServers: { reins: { type: "http", url: `http://127.0.0.1:${port}/mcp` } } },
    null,
    2,
  );
}

export function healthSummary(
  h: { ok: boolean; version: string; paired: boolean } | undefined,
  port: number,
): string {
  if (!h) {
    return [
      `daemon : not running on 127.0.0.1:${port}`,
      "         start it with `reins up` (or `reins serve` in the foreground)",
    ].join("\n");
  }
  return [
    `daemon : running on 127.0.0.1:${port} (v${h.version})`,
    `browser: ${h.paired ? "browser connected" : "no browser connected — is the extension installed?"}`,
  ].join("\n");
}
```

(`installText(port)` and `helpText(version)` are the same shape as today, re-worded for the new commands; `helpText` lists: up, down, restart, serve [--stdio], install [claude|codex], allow <extension-id>, status, doctor, logs.)

`cli.ts` — same switch style as today. New/changed cases (`loadOrCreateConfig` for port, dynamic imports for heavy modules):

```ts
case "up": {
  const { serviceUp } = await import("./service.js");
  await serviceUp();
  console.log("reins daemon installed + started (autostarts on login).");
  console.log("Next: `reins install claude`, then add the browser extension.");
  break;
}
case "down": {
  const { serviceDown } = await import("./service.js");
  await serviceDown();
  console.log("reins daemon stopped and removed from autostart.");
  break;
}
case "restart": {
  const { serviceRestart } = await import("./service.js");
  await serviceRestart();
  console.log("reins daemon restarted.");
  break;
}
case "serve": {
  const { runServe } = await import("./serve.js");
  await runServe({ stdio: rest.includes("--stdio") });
  break;
}
case "allow": {
  const id = rest[0];
  if (!id) {
    console.error("usage: reins allow <extension-id>");
    process.exitCode = 1;
    break;
  }
  const { allowExtension } = await import("./allowlist.js");
  allowExtension(loadOrCreateConfig().dir, id);
  console.log(`allowed ${id} — restart the daemon (reins restart) to pick it up.`);
  break;
}
case "status": {
  const cfg = loadOrCreateConfig();
  let health: { ok: boolean; version: string; paired: boolean } | undefined;
  try {
    const res = await fetch(`http://127.0.0.1:${cfg.port}/health`, {
      signal: AbortSignal.timeout(1000),
    });
    if (res.ok) health = (await res.json()) as typeof health;
  } catch {
    // not running
  }
  console.log(healthSummary(health, cfg.port));
  console.log(`logs   : ${logsDir()}`);
  break;
}
case "install": {
  const cfg = loadOrCreateConfig();
  const client = rest[0];
  if (client === "claude") {
    const args = claudeInstallArgs(cfg.port);
    const res = spawnSync("claude", args, { stdio: "inherit" });
    if (res.error || res.status !== 0) {
      console.error(
        ["", "Could not run the claude CLI. Register manually:", `  claude ${args.join(" ")}`].join(
          "\n",
        ),
      );
      process.exitCode = 1;
      break;
    }
    console.log("\nreins registered with Claude Code (user scope).");
    console.log("Next: `reins up` (if not already) and install the browser extension.");
  } else if (client === "codex") {
    console.log("Add to ~/.codex/config.toml:\n");
    console.log(codexSnippet(cfg.port));
  } else if (client === undefined) {
    console.log(installText(cfg.port));
  } else {
    console.error(`unknown client "${client}" — expected claude or codex\n`);
    console.log(installText(cfg.port));
    process.exitCode = 1;
  }
  break;
}
```

Delete the `pair` case and the old TCP `probePort` helper (status now uses `/health`). `doctor` gains a daemon check: reuse the same fetch, add `{ name: "daemon", ok: health !== undefined, detail: … }`.

- [ ] **Step 4: Run + smoke**

Run: `pnpm --filter reins-mcp build && pnpm --filter reins-mcp test && node packages/mcp/dist/cli.js help && node packages/mcp/dist/cli.js status`
Expected: tests PASS; help shows the new command set; status prints "not running … reins up".

- [ ] **Step 5: Commit**

```bash
git add packages/mcp/src
git commit -m "feat(cli): up/down/restart/serve/allow/status against the daemon; retire pair"
```

---

### Task 8: Extension — auto-connect, settings instead of pairing, popup rework

**Files:**
- Create: `packages/extension/src/lib/settings.ts`, `packages/extension/src/lib/settings.test.ts`
- Delete: `packages/extension/src/lib/pairing.ts`, `packages/extension/src/lib/pairing.test.ts`
- Modify: `packages/extension/src/lib/bridge-client.ts`, `packages/extension/src/lib/bridge-client.test.ts`, `packages/extension/src/lib/backoff.ts`, `packages/extension/src/lib/backoff.test.ts`, `packages/extension/src/background.ts`, `packages/extension/src/offscreen.ts`, `packages/extension/src/popup.ts`, `packages/extension/src/popup.html`, `packages/extension/src/lib/status.ts` (drop "error"), `packages/extension/src/lib/status.test.ts`

**Interfaces:**
- Consumes: tokenless `HelloFrame` (Task 1).
- Produces:
  - `settings.ts`: `interface Settings { autoConnect: boolean; port: number }`, `loadSettings(): Promise<Settings>` (defaults `{ autoConnect: true, port: 8765 }`), `saveSettings(s: Partial<Settings>): Promise<void>`, `wsUrl(s: Settings): string` → `ws://127.0.0.1:<port>`.
  - `BridgeClientOptions` loses `token` and `onAuthError`; hello frame is `{ type: "hello", browser }`.
  - `nextBackoff(attempt, baseMs = 500, maxMs = 10_000)`.
  - `WorkerStatus` = `"idle" | "connecting" | "connected"`.

- [ ] **Step 1: Write/adjust the failing tests**

`packages/extension/src/lib/settings.test.ts` (mirror the storage-mock style used in `pairing.test.ts` — an in-memory `chrome.storage.local` stub):

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadSettings, saveSettings, wsUrl } from "./settings.js";

const store = new Map<string, unknown>();
beforeEach(() => {
  store.clear();
  vi.stubGlobal("chrome", {
    storage: {
      local: {
        get: async (keys: string[]) =>
          Object.fromEntries(keys.map((k) => [k, store.get(k)])),
        set: async (items: Record<string, unknown>) => {
          for (const [k, v] of Object.entries(items)) store.set(k, v);
        },
      },
    },
  });
});

describe("settings", () => {
  it("defaults to autoConnect on port 8765", async () => {
    expect(await loadSettings()).toEqual({ autoConnect: true, port: 8765 });
  });

  it("round-trips partial saves", async () => {
    await saveSettings({ autoConnect: false });
    await saveSettings({ port: 9000 });
    expect(await loadSettings()).toEqual({ autoConnect: false, port: 9000 });
  });

  it("wsUrl builds the localhost URL", () => {
    expect(wsUrl({ autoConnect: true, port: 8765 })).toBe("ws://127.0.0.1:8765");
  });
});
```

In `bridge-client.test.ts`: remove `token` from all option fixtures, change hello assertions to `{ type: "hello", browser: … }`, delete the 4001/onAuthError test. In `backoff.test.ts`: assert the cap is `10_000` (e.g. `expect(nextBackoff(20)).toBe(10_000)`). In `status.test.ts`: `"error"` now normalizes to `"idle"`.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @reins/extension test`
Expected: FAIL across the adjusted suites.

- [ ] **Step 3: Implement**

`settings.ts`:

```ts
export interface Settings {
  autoConnect: boolean;
  port: number;
}

const AUTO_KEY = "reinsAutoConnect";
const PORT_KEY = "reinsPort";
const DEFAULTS: Settings = { autoConnect: true, port: 8765 };

export async function loadSettings(): Promise<Settings> {
  const got = await chrome.storage.local.get([AUTO_KEY, PORT_KEY]);
  return {
    autoConnect: typeof got[AUTO_KEY] === "boolean" ? got[AUTO_KEY] : DEFAULTS.autoConnect,
    port: typeof got[PORT_KEY] === "number" ? got[PORT_KEY] : DEFAULTS.port,
  };
}

export async function saveSettings(s: Partial<Settings>): Promise<void> {
  const items: Record<string, unknown> = {};
  if (s.autoConnect !== undefined) items[AUTO_KEY] = s.autoConnect;
  if (s.port !== undefined) items[PORT_KEY] = s.port;
  await chrome.storage.local.set(items);
}

export function wsUrl(s: Settings): string {
  return `ws://127.0.0.1:${s.port}`;
}
```

`backoff.ts`: change signature default to `maxMs = 10_000`.

`bridge-client.ts`: remove `token` and `onAuthError` from `BridgeClientOptions`; `socket.onopen` sends `JSON.stringify({ type: "hello", browser: this.#opts.browser })`; delete the `code === 4001` branch in `#onClose` (every close now schedules a reconnect unless stopped).

`status.ts`:

```ts
export type WorkerStatus = "idle" | "connecting" | "connected";

export function normalizeStatus(raw: unknown): WorkerStatus {
  if (raw === "connecting" || raw === "connected") return raw;
  return "idle";
}
```

`background.ts`: replace `loadPairing` with settings. `autoConnect()` becomes:

```ts
import { loadSettings, saveSettings, wsUrl } from "./lib/settings.js";

async function autoConnect(): Promise<void> {
  const s = await loadSettings();
  if (!s.autoConnect) return;
  await ensureOffscreen();
  send({ type: "offscreen:connect", url: wsUrl(s), browser: "reins-extension" });
}
```

`reins:connect` handler: `await saveSettings({ autoConnect: true })` then the same connect (read settings fresh). `reins:disconnect`: `void saveSettings({ autoConnect: false })`, send `offscreen:disconnect`, `writeStatus("idle")`. Everything else (session-storage status, dispatch) stays.

`offscreen.ts`: drop `token` from the destructured message and from `BridgeClient` options; delete the `onAuthError` callback.

`popup.html` body becomes (keep the existing stylesheet classes):

```html
<main class="reins">
  <header class="reins__header">
    <h1>reins</h1>
    <span id="status" class="reins__status reins__status--idle">
      <span id="status-label">Disconnected</span>
    </span>
  </header>
  <p class="reins__hint">
    Connects automatically to the local reins daemon
    (<code>reins up</code> to start it).
  </p>
  <button id="toggle" type="button">Disconnect</button>
  <details class="reins__advanced">
    <summary>Advanced</summary>
    <label for="port">Daemon port</label>
    <input id="port" type="number" min="1" max="65535" />
    <button id="save-port" type="button">Save &amp; reconnect</button>
  </details>
</main>
```

`popup.ts`:

```ts
import "./popup.css";
import { loadSettings, saveSettings } from "./lib/settings.js";
import { normalizeStatus, type WorkerStatus } from "./lib/status.js";

const statusEl = document.getElementById("status") as HTMLElement;
const statusLabel = document.getElementById("status-label") as HTMLElement;
const toggleBtn = document.getElementById("toggle") as HTMLButtonElement;
const portInput = document.getElementById("port") as HTMLInputElement;
const savePortBtn = document.getElementById("save-port") as HTMLButtonElement;

const LABELS: Record<WorkerStatus, string> = {
  idle: "Disconnected",
  connecting: "Connecting…",
  connected: "Connected",
};

function setStatus(status: WorkerStatus): void {
  statusEl.className = `reins__status reins__status--${status}`;
  statusLabel.textContent = LABELS[status];
}

function notifyBackground(type: string): void {
  try {
    chrome.runtime.sendMessage({ type }, () => void chrome.runtime.lastError);
  } catch {
    // worker unavailable; settings are persisted regardless
  }
}

async function refresh(): Promise<void> {
  const s = await loadSettings();
  portInput.value = String(s.port);
  toggleBtn.textContent = s.autoConnect ? "Disconnect" : "Connect";
  try {
    const res = (await chrome.runtime.sendMessage({ type: "reins:status" })) as
      | { status?: unknown }
      | undefined;
    setStatus(normalizeStatus(res?.status));
  } catch {
    setStatus("idle");
  }
}

chrome.runtime.onMessage.addListener((msg: unknown) => {
  if (!msg || typeof msg !== "object") return;
  const message = msg as Record<string, unknown>;
  if (message.type === "reins:status-update") setStatus(normalizeStatus(message.status));
});

toggleBtn.addEventListener("click", async () => {
  const s = await loadSettings();
  if (s.autoConnect) {
    notifyBackground("reins:disconnect");
    toggleBtn.textContent = "Connect";
    setStatus("idle");
  } else {
    notifyBackground("reins:connect");
    toggleBtn.textContent = "Disconnect";
    setStatus("connecting");
  }
});

savePortBtn.addEventListener("click", async () => {
  const port = Number(portInput.value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return;
  await saveSettings({ port });
  notifyBackground("reins:connect");
  setStatus("connecting");
});

void refresh();
```

Delete `pairing.ts` + `pairing.test.ts`. If `popup.css` styles `.reins__status--error`, delete that rule and add a minimal `.reins__advanced { margin-top: 12px; }` if absent.

- [ ] **Step 4: Full extension check**

Run: `pnpm --filter @reins/extension test && pnpm --filter @reins/extension typecheck && pnpm --filter @reins/extension build`
Expected: all PASS; `dist/` builds.

- [ ] **Step 5: Commit**

```bash
git add -A packages/extension
git commit -m "feat(extension)!: auto-connect to the local daemon; settings replace pairing; simpler popup"
```

---

### Task 9: Rename to @karnstack/reins + workflows, docs, versions

**Files:**
- Modify: `packages/mcp/package.json`, `packages/extension/package.json`, `package.json` (root scripts), `packages/mcp/README.md`, `README.md`, `docs/RUNNING.md`, `docs/PUBLISHING.md`, `docs/PRIVACY.md`, `.github/workflows/release.yml`
- Test: existing suites (no new tests; this is metadata + docs)

**Interfaces:**
- Produces: npm package `@karnstack/reins@0.2.0`, bin `{ "reins": "./dist/cli.js" }`.

- [ ] **Step 1: Package + workspace renames**

`packages/mcp/package.json`: `"name": "@karnstack/reins"`, `"version": "0.2.0"`, `"bin": { "reins": "./dist/cli.js" }` (drop `reins-mcp`), description → "One CLI for reins: local MCP daemon that drives your real, logged-in browser through the reins extension." Keep `publishConfig.access: public` (required for scoped).
`packages/extension/package.json`: `"version": "0.2.0"`.
Root `package.json` scripts: filters `--filter=reins-mcp` → `--filter=@karnstack/reins`; `"mcp"` script → `node packages/mcp/dist/cli.js serve`.
`.github/workflows/release.yml`: `pnpm publish --filter @karnstack/reins --access public --no-git-checks`.

- [ ] **Step 2: Docs**

- `README.md`: Install section becomes the four-liner (`npm i -g @karnstack/reins`, `reins up`, `reins install claude`, install extension → auto-connects). Remove pairing steps. Note multiple concurrent MCP clients now supported. Update the "How it works" diagram label to "localhost WebSocket (extension-ID pinned)".
- `docs/RUNNING.md`: dev flow — `pnpm build`, `chrome://extensions` → load unpacked → copy the extension ID → `pnpm reins allow <id>` → `pnpm reins serve` (foreground) or `reins up`; `claude mcp add --transport http reins http://127.0.0.1:8765/mcp`. Troubleshooting: "pill stays Disconnected" → daemon not running (`reins status`) or dev ID not allowlisted (`reins allow`).
- `docs/PUBLISHING.md`: add step "after first Chrome Web Store publish, put the store extension ID into `PUBLISHED_EXTENSION_IDS` in `packages/mcp/src/allowlist.ts` and release a patch"; update package name and the pack smoke-test command (`npx -y ./karnstack-reins-*.tgz status`).
- `docs/PRIVACY.md`: replace the pairing-token sentences — authentication is the extension's identity (its ID) checked by the local daemon; still nothing leaves the machine.

- [ ] **Step 3: Full verification**

Run: `pnpm format && pnpm lint && pnpm build && pnpm typecheck && pnpm test && pnpm zip`
Expected: all green. Then the end-to-end smoke:

```bash
REINS_PORT=18999 node packages/mcp/dist/cli.js serve & sleep 1
curl -s http://127.0.0.1:18999/health           # {"ok":true,"version":"0.2.0","paired":false}
node packages/mcp/dist/cli.js status            # daemon not running on 8765 (expected, test port)
kill %1
cd packages/mcp && npm pack --dry-run | tail -5 # name @karnstack/reins, version 0.2.0
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat!: rename to @karnstack/reins; docs + release flow for the daemon UX"
```

---

## Manual verification checklist (after all tasks, macOS)

1. `pnpm build && node packages/mcp/dist/cli.js up` → `reins status` shows running.
2. Load unpacked `packages/extension/dist`, copy its ID, `node packages/mcp/dist/cli.js allow <id>`, `… restart`.
3. Popup pill turns green without any input.
4. `claude mcp add --transport http reins http://127.0.0.1:8765/mcp` → in a Claude Code session, `list_tabs` returns live tabs; run a second client concurrently.
5. `node packages/mcp/dist/cli.js down` → pill goes Disconnected; popup toggle reconnects after `up`.
