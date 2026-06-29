# reins M1b-core — Extension Bridge Client Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the node-verifiable core of the reins browser extension: a transport-agnostic `BridgeClient` (the inverse of M1a's `BridgeHost` — connects, authenticates, answers requests, reconnects), plus the `chrome.storage` pairing module and the `chrome.tabs` `list_tabs` handler — each unit-tested, with `BridgeClient` proven against a real WebSocket protocol server in node.

**Architecture:** `BridgeClient` takes its WebSocket via an injected factory (browser supplies the global `WebSocket`; tests supply `ws`) and a `dispatch(method, params)` callback (browser wires it to the tab handler; tests supply a fake). This keeps all protocol logic out of chrome-specific glue, so it is fully testable in node. The offscreen-document host, service-worker messaging, popup UI, and Playwright e2e are the next plan (M1b-wire).

**Tech Stack:** TypeScript 6.0.3, @reins/protocol (Tab type), ws 8.21.0 (test-only WebSocket impl + stand-in server), vitest 4.1.9, @types/chrome 0.2.0. Node 24.18.0 / pnpm 11.9.0 via mise.

## Global Constraints

- **Exact versions only** — no ^/~/latest. Run tooling through `mise exec --`.
- **ESM everywhere** — `"type":"module"`, intra-repo relative imports use `.js`.
- **Repo:** `~/code/karnstack/reins`, branch `feat/m1b-core`.
- **Per-task gate (MANDATORY, run all before each commit):** `mise exec -- pnpm lint` (root biome — no errors; scoped `// biome-ignore` only, never global disables), `mise exec -- pnpm typecheck`, `mise exec -- pnpm --filter @reins/extension test`, `mise exec -- pnpm build`. (Earlier milestones accrued lint debt by skipping root lint.)
- **Wire protocol (must match @reins/protocol + M1a BridgeHost exactly):** client→server `hello{type,token,browser}` and `response{type:"response",id,ok,result?|error?}`; server→client `welcome{type:"welcome",server}` and `request{type:"request",id,method,params}`. `error = {code,message}`.
- **Production code must NOT import `ws`** — it uses the injected socket factory only. `ws` is a test-only devDependency (browser provides `WebSocket`).
- **Reconnect** uses the existing `nextBackoff(attempt)` from `src/lib/backoff.ts`.

---

### Task 1: `BridgeClient` transport logic + node protocol test

**Files:**
- Create: `packages/extension/src/lib/bridge-client.ts`, `packages/extension/src/lib/bridge-client.test.ts`
- Modify: `packages/extension/package.json` (add test-only devDeps `ws` `8.21.0`, `@types/ws` `8.18.1`)

**Interfaces:**
- Consumes: `nextBackoff` from `./backoff.js`.
- Produces:
  - types `Dispatch = (method: string, params: unknown) => Promise<unknown>`, `ConnectionStatus = "connecting" | "connected" | "disconnected"`, `SocketLike` (browser-WebSocket-shaped: `send`, `close`, nullable `onopen`/`onmessage`/`onclose`/`onerror`).
  - `class BridgeClient` with `constructor(opts: BridgeClientOptions)`, `start(): void`, `stop(): void`. `BridgeClientOptions = { url, token, browser, dispatch, createSocket: (url) => SocketLike, onStatus?, schedule? }`.

- [ ] **Step 1: Add test-only devDeps** — `packages/extension/package.json`

Add to `devDependencies` (keep alphabetical, exact versions):
```json
    "@types/ws": "8.18.1",
    "ws": "8.21.0"
```
Then run: `mise exec -- pnpm install`
Expected: exits 0; `ws` + `@types/ws` resolved for `@reins/extension`.

- [ ] **Step 2: Write the failing test** — `packages/extension/src/lib/bridge-client.test.ts`

```ts
import type { AddressInfo } from "node:net";
import { type RawData, WebSocket, WebSocketServer } from "ws";
import { afterEach, describe, expect, it } from "vitest";
import { BridgeClient, type SocketLike } from "./bridge-client.js";

const TOKEN = "client-token";

interface Harness {
  server: WebSocketServer;
  port: number;
  /** the most recently accepted server-side socket */
  current(): WebSocket | undefined;
}

let harness: Harness | undefined;
let client: BridgeClient | undefined;

afterEach(async () => {
  client?.stop();
  client = undefined;
  await new Promise<void>((resolve) => {
    if (!harness) return resolve();
    harness.server.close(() => resolve());
  });
  harness = undefined;
});

/** A stand-in reins server: origin check, hello->welcome, exposes the live socket. */
function startServer(): Promise<Harness> {
  return new Promise((resolve) => {
    let live: WebSocket | undefined;
    const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    server.on("connection", (ws, req) => {
      if (!req.headers.origin?.startsWith("chrome-extension://")) return ws.close(4003);
      ws.on("message", (data: RawData) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === "hello" && msg.token === TOKEN) {
          live = ws;
          ws.send(JSON.stringify({ type: "welcome", server: "reins" }));
        }
      });
    });
    server.on("listening", () => {
      const port = (server.address() as AddressInfo).port;
      resolve({ server, port, current: () => live });
    });
  });
}

/** Browser-WebSocket-shaped factory backed by node `ws`, with the extension origin. */
function nodeSocketFactory(url: string): SocketLike {
  const ws = new WebSocket(url, { headers: { origin: "chrome-extension://test" } });
  const sock: SocketLike = {
    send: (d) => ws.send(d),
    close: () => ws.close(),
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
  };
  ws.on("open", () => sock.onopen?.());
  ws.on("message", (d: RawData) => sock.onmessage?.({ data: d.toString() }));
  ws.on("close", () => sock.onclose?.());
  ws.on("error", (e) => sock.onerror?.(e));
  return sock;
}

function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      if (predicate()) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error("waitFor timed out"));
      setTimeout(tick, 10);
    };
    tick();
  });
}

describe("BridgeClient", () => {
  it("connects, sends hello, and reaches connected on welcome", async () => {
    harness = await startServer();
    let status = "";
    client = new BridgeClient({
      url: `ws://127.0.0.1:${harness.port}`,
      token: TOKEN,
      browser: "test",
      dispatch: async () => ({}),
      createSocket: nodeSocketFactory,
      onStatus: (s) => {
        status = s;
      },
    });
    client.start();
    await waitFor(() => status === "connected");
    expect(status).toBe("connected");
  });

  it("dispatches a request and replies with the result", async () => {
    harness = await startServer();
    client = new BridgeClient({
      url: `ws://127.0.0.1:${harness.port}`,
      token: TOKEN,
      browser: "test",
      dispatch: async (method) => (method === "list_tabs" ? { tabs: [{ tabId: 1 }] } : {}),
      createSocket: nodeSocketFactory,
    });
    client.start();
    await waitFor(() => harness?.current() !== undefined);

    const response = await new Promise<Record<string, unknown>>((resolve) => {
      const ws = harness!.current()!;
      ws.on("message", (d: RawData) => {
        const m = JSON.parse(d.toString());
        if (m.type === "response") resolve(m);
      });
      ws.send(JSON.stringify({ type: "request", id: "r1", method: "list_tabs", params: {} }));
    });
    expect(response).toMatchObject({ id: "r1", ok: true, result: { tabs: [{ tabId: 1 }] } });
  });

  it("replies ok:false when the dispatcher throws", async () => {
    harness = await startServer();
    client = new BridgeClient({
      url: `ws://127.0.0.1:${harness.port}`,
      token: TOKEN,
      browser: "test",
      dispatch: async () => {
        throw new Error("boom");
      },
      createSocket: nodeSocketFactory,
    });
    client.start();
    await waitFor(() => harness?.current() !== undefined);

    const response = await new Promise<Record<string, unknown>>((resolve) => {
      const ws = harness!.current()!;
      ws.on("message", (d: RawData) => {
        const m = JSON.parse(d.toString());
        if (m.type === "response") resolve(m);
      });
      ws.send(JSON.stringify({ type: "request", id: "r2", method: "x", params: {} }));
    });
    expect(response.ok).toBe(false);
    expect((response.error as { message: string }).message).toBe("boom");
  });

  it("reconnects after the socket drops", async () => {
    harness = await startServer();
    let connects = 0;
    client = new BridgeClient({
      url: `ws://127.0.0.1:${harness.port}`,
      token: TOKEN,
      browser: "test",
      dispatch: async () => ({}),
      createSocket: nodeSocketFactory,
      onStatus: (s) => {
        if (s === "connected") connects += 1;
      },
      schedule: (fn) => {
        setTimeout(fn, 5);
      },
    });
    client.start();
    await waitFor(() => connects === 1);
    harness.current()?.close();
    await waitFor(() => connects === 2);
    expect(connects).toBe(2);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `mise exec -- pnpm --filter @reins/extension test bridge-client`
Expected: FAIL — cannot resolve `./bridge-client.js`.

- [ ] **Step 4: Write the implementation** — `packages/extension/src/lib/bridge-client.ts`

```ts
import { nextBackoff } from "./backoff.js";

export type Dispatch = (method: string, params: unknown) => Promise<unknown>;
export type ConnectionStatus = "connecting" | "connected" | "disconnected";

/** The subset of the browser WebSocket API that BridgeClient uses. */
export interface SocketLike {
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
  onerror: ((err: unknown) => void) | null;
}

export interface BridgeClientOptions {
  url: string;
  token: string;
  browser: string;
  dispatch: Dispatch;
  createSocket: (url: string) => SocketLike;
  onStatus?: (status: ConnectionStatus) => void;
  /** Schedule a reconnect attempt; injectable for tests. Defaults to setTimeout. */
  schedule?: (fn: () => void, ms: number) => void;
}

/**
 * Client half of the reins bridge: connects to the MCP server's WebSocket,
 * authenticates with the pairing token, answers `request` frames via `dispatch`,
 * and reconnects with exponential backoff. Transport-agnostic via `createSocket`.
 */
export class BridgeClient {
  readonly #opts: BridgeClientOptions;
  #socket: SocketLike | undefined;
  #attempt = 0;
  #stopped = false;

  constructor(opts: BridgeClientOptions) {
    this.#opts = opts;
  }

  start(): void {
    this.#stopped = false;
    this.#connect();
  }

  stop(): void {
    this.#stopped = true;
    this.#socket?.close();
    this.#socket = undefined;
  }

  #connect(): void {
    this.#opts.onStatus?.("connecting");
    const socket = this.#opts.createSocket(this.#opts.url);
    this.#socket = socket;
    socket.onopen = () => {
      socket.send(
        JSON.stringify({ type: "hello", token: this.#opts.token, browser: this.#opts.browser }),
      );
    };
    socket.onmessage = (ev) => this.#onMessage(String(ev.data));
    socket.onclose = () => this.#onClose();
    socket.onerror = () => socket.close();
  }

  #onClose(): void {
    this.#socket = undefined;
    this.#opts.onStatus?.("disconnected");
    if (this.#stopped) return;
    this.#attempt += 1;
    const delay = nextBackoff(this.#attempt);
    const schedule = this.#opts.schedule ?? ((fn, ms) => void setTimeout(fn, ms));
    schedule(() => {
      if (!this.#stopped) this.#connect();
    }, delay);
  }

  #onMessage(raw: string): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }
    if (msg.type === "welcome") {
      this.#attempt = 0;
      this.#opts.onStatus?.("connected");
      return;
    }
    if (msg.type === "request" && typeof msg.id === "string" && typeof msg.method === "string") {
      void this.#handleRequest(msg.id, msg.method, msg.params);
    }
  }

  async #handleRequest(id: string, method: string, params: unknown): Promise<void> {
    const socket = this.#socket;
    if (!socket) return;
    try {
      const result = await this.#opts.dispatch(method, params);
      socket.send(JSON.stringify({ type: "response", id, ok: true, result }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      socket.send(
        JSON.stringify({ type: "response", id, ok: false, error: { code: "HANDLER_ERROR", message } }),
      );
    }
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `mise exec -- pnpm --filter @reins/extension test bridge-client`
Expected: PASS — 4 tests. Run it 3 times to confirm the async/reconnect tests are not flaky.

- [ ] **Step 6: MANDATORY gate + commit**

Run: `mise exec -- pnpm lint && mise exec -- pnpm typecheck && mise exec -- pnpm --filter @reins/extension test && mise exec -- pnpm build`
Expected: all exit 0. If lint flags `noNonNullAssertion` on a `!` in the test, add a scoped `// biome-ignore lint/style/noNonNullAssertion: <reason>` (the harness uses `harness!.current()!`).

```bash
git add -A
git commit -m "feat(extension): BridgeClient transport (hello/welcome/request/reconnect)"
```

---

### Task 2: Pairing storage + `list_tabs` tab handler

**Files:**
- Create: `packages/extension/src/lib/pairing.ts`, `packages/extension/src/lib/pairing.test.ts`, `packages/extension/src/lib/tab-handler.ts`, `packages/extension/src/lib/tab-handler.test.ts`

**Interfaces:**
- Consumes: `chrome.storage.local`, `chrome.tabs` (mocked in tests via `vi.stubGlobal`); `Tab` type from `@reins/protocol`.
- Produces:
  - `interface Pairing { url: string; token: string }`; `loadPairing(): Promise<Pairing | undefined>`, `savePairing(p: Pairing): Promise<void>`, `clearPairing(): Promise<void>`.
  - `listTabs(): Promise<{ tabs: Tab[] }>` (maps `chrome.tabs.query({})` to `Tab[]`).

- [ ] **Step 1: Write the failing test** — `packages/extension/src/lib/pairing.test.ts`

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearPairing, loadPairing, savePairing } from "./pairing.js";

function mockStorage() {
  const store = new Map<string, unknown>();
  vi.stubGlobal("chrome", {
    storage: {
      local: {
        get: async (keys: string[]) => {
          const out: Record<string, unknown> = {};
          for (const k of keys) if (store.has(k)) out[k] = store.get(k);
          return out;
        },
        set: async (items: Record<string, unknown>) => {
          for (const [k, v] of Object.entries(items)) store.set(k, v);
        },
        remove: async (keys: string[]) => {
          for (const k of keys) store.delete(k);
        },
      },
    },
  });
  return store;
}

afterEach(() => vi.unstubAllGlobals());

describe("pairing", () => {
  it("returns undefined when nothing is stored", async () => {
    mockStorage();
    expect(await loadPairing()).toBeUndefined();
  });

  it("round-trips a saved pairing", async () => {
    mockStorage();
    await savePairing({ url: "ws://127.0.0.1:8765", token: "abc" });
    expect(await loadPairing()).toEqual({ url: "ws://127.0.0.1:8765", token: "abc" });
  });

  it("clears a pairing", async () => {
    mockStorage();
    await savePairing({ url: "ws://x", token: "t" });
    await clearPairing();
    expect(await loadPairing()).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `mise exec -- pnpm --filter @reins/extension test pairing`
Expected: FAIL — cannot resolve `./pairing.js`.

- [ ] **Step 3: Write the implementation** — `packages/extension/src/lib/pairing.ts`

```ts
export interface Pairing {
  url: string;
  token: string;
}

const URL_KEY = "reinsUrl";
const TOKEN_KEY = "reinsToken";

/** Load the saved pairing (server URL + token) from extension storage. */
export async function loadPairing(): Promise<Pairing | undefined> {
  const got = await chrome.storage.local.get([URL_KEY, TOKEN_KEY]);
  const url = got[URL_KEY];
  const token = got[TOKEN_KEY];
  if (typeof url === "string" && typeof token === "string") return { url, token };
  return undefined;
}

/** Persist the pairing entered in the popup. */
export async function savePairing(pairing: Pairing): Promise<void> {
  await chrome.storage.local.set({ [URL_KEY]: pairing.url, [TOKEN_KEY]: pairing.token });
}

/** Remove the pairing (kill switch / unpair). */
export async function clearPairing(): Promise<void> {
  await chrome.storage.local.remove([URL_KEY, TOKEN_KEY]);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `mise exec -- pnpm --filter @reins/extension test pairing`
Expected: PASS — 3 tests.

- [ ] **Step 5: Write the failing test** — `packages/extension/src/lib/tab-handler.test.ts`

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { listTabs } from "./tab-handler.js";

afterEach(() => vi.unstubAllGlobals());

describe("listTabs", () => {
  it("maps chrome tabs to the Tab shape", async () => {
    vi.stubGlobal("chrome", {
      tabs: {
        query: async () => [
          { id: 1, title: "Home", url: "https://a", active: true },
          { id: 2, title: "Docs", url: "https://b", active: false },
        ],
      },
    });
    const { tabs } = await listTabs();
    expect(tabs).toEqual([
      { tabId: 1, title: "Home", url: "https://a", active: true },
      { tabId: 2, title: "Docs", url: "https://b", active: false },
    ]);
  });

  it("fills defaults for missing fields", async () => {
    vi.stubGlobal("chrome", { tabs: { query: async () => [{}] } });
    const { tabs } = await listTabs();
    expect(tabs).toEqual([{ tabId: -1, title: "", url: "", active: false }]);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `mise exec -- pnpm --filter @reins/extension test tab-handler`
Expected: FAIL — cannot resolve `./tab-handler.js`.

- [ ] **Step 7: Write the implementation** — `packages/extension/src/lib/tab-handler.ts`

```ts
import type { Tab } from "@reins/protocol";

/** Handle the `list_tabs` bridge method using chrome.tabs. */
export async function listTabs(): Promise<{ tabs: Tab[] }> {
  const tabs = await chrome.tabs.query({});
  return {
    tabs: tabs.map((t) => ({
      tabId: t.id ?? -1,
      title: t.title ?? "",
      url: t.url ?? "",
      active: t.active ?? false,
    })),
  };
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `mise exec -- pnpm --filter @reins/extension test tab-handler`
Expected: PASS — 2 tests.

- [ ] **Step 9: MANDATORY gate + commit**

Run: `mise exec -- pnpm lint && mise exec -- pnpm typecheck && mise exec -- pnpm --filter @reins/extension test && mise exec -- pnpm build`
Expected: all exit 0. Extension test total now: backoff 2 + bridge-client 4 + pairing 3 + tab-handler 2 = 11.

```bash
git add -A
git commit -m "feat(extension): pairing storage + list_tabs tab handler"
```

---

## Self-Review

**1. Spec coverage (design §11.2 M1, browser half — core):** the extension's authenticated WS client speaking the bridge protocol → Task 1 (`BridgeClient`, proven against a real `ws` server in node); pairing token storage from the popup → Task 2 (`pairing.ts`); the `list_tabs` request handler via `chrome.tabs` → Task 2 (`tab-handler.ts`); reconnect with `nextBackoff` → Task 1. The offscreen-document host, service-worker↔offscreen messaging, popup UI, and real-browser Playwright e2e are explicitly deferred to M1b-wire.

**2. Placeholder scan:** No TBD/vague steps. Every step has complete code or an exact command + expected output. The reconnect, error-branch, and auth paths all have concrete tests.

**3. Type consistency:** `BridgeClient`/`BridgeClientOptions`/`SocketLike`/`Dispatch`/`ConnectionStatus` defined in Task 1 are used identically in its test. `Pairing` + `loadPairing`/`savePairing`/`clearPairing` and `listTabs(): Promise<{tabs: Tab[]}>` consistent across Task 2 impl + tests. Wire frames (`hello`/`welcome`/`request`/`response`) match @reins/protocol and M1a's BridgeHost exactly. `Tab` shape (`tabId`/`title`/`url`/`active`) matches @reins/protocol.

## Notes for M1b-wire (next plan)
- `offscreen.ts`: instantiate `BridgeClient` with the global `WebSocket` as `createSocket` and a `dispatch` that round-trips to the service worker via `chrome.runtime` messaging.
- `background.ts` (worker): manage the offscreen document lifecycle (`chrome.offscreen.createDocument`), read pairing from storage, push url+token to offscreen, dispatch bridge methods (`list_tabs` → `tab-handler`), handle popup messages.
- Popup UI: pairing form (url+token → `savePairing`), connection indicator, kill switch (`clearPairing` + disconnect) — styled to match the violet icon; consider the design skill here.
- Playwright e2e: load the unpacked extension + a real `BridgeHost`, assert a real `list_tabs` round trip.
- Carry M1a review items: BridgeHost self-validate via @reins/protocol schemas; server.ts EADDRINUSE; capture hello.browser; chmod 0700.
