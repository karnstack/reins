import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { type RawData, WebSocket, WebSocketServer } from "ws";
import { BridgeClient, type SocketLike } from "./bridge-client.js";

interface Harness {
  server: WebSocketServer;
  port: number;
  /** the most recently accepted server-side socket */
  current(): WebSocket | undefined;
}

let harness: Harness | undefined;
let silentServer: WebSocketServer | undefined;
let client: BridgeClient | undefined;

afterEach(async () => {
  client?.stop();
  client = undefined;
  await new Promise<void>((resolve) => {
    if (!harness) return resolve();
    harness.server.close(() => resolve());
  });
  harness = undefined;
  await new Promise<void>((resolve) => {
    if (!silentServer) return resolve();
    silentServer.close(() => resolve());
  });
  silentServer = undefined;
});

/** A stand-in reins daemon: hello → welcome, exposes the live socket. */
function startServer(): Promise<Harness> {
  return new Promise((resolve) => {
    let live: WebSocket | undefined;
    const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    server.on("connection", (ws, req) => {
      if (!req.headers.origin?.startsWith("chrome-extension://")) return ws.close(4003);
      ws.on("message", (data: RawData) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === "hello") {
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

/** A WS server that accepts connections but never answers hello (not reins). */
function startSilentServer(): Promise<number> {
  return new Promise((resolve) => {
    silentServer = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    silentServer.on("listening", () => {
      resolve((silentServer?.address() as AddressInfo).port);
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
  ws.on("close", (code) => sock.onclose?.({ code }));
  ws.on("error", (e) => sock.onerror?.(e));
  return sock;
}

function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
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

function makeClient(
  urls: string[],
  over: Partial<ConstructorParameters<typeof BridgeClient>[0]> = {},
) {
  return new BridgeClient({
    urls: () => urls,
    browser: "test",
    dispatch: async () => ({}),
    createSocket: nodeSocketFactory,
    // Production default. A short probe window is a flake hazard on loaded CI
    // runners: if the timer fires before the welcome frame is processed, the
    // client abandons a socket the server already accepted. Tests that need
    // fast probe turnover override this per-test.
    probeTimeoutMs: 1500,
    ...over,
  });
}

describe("BridgeClient", () => {
  it("connects, sends hello, and reaches connected on welcome", async () => {
    harness = await startServer();
    let status = "";
    client = makeClient([`ws://127.0.0.1:${harness.port}`], {
      onStatus: (s) => {
        status = s;
      },
    });
    client.start();
    await waitFor(() => status === "connected");
    expect(status).toBe("connected");
  });

  it("discovers the daemon across candidates: dead port, silent server, then reins", async () => {
    harness = await startServer();
    const silentPort = await startSilentServer();
    // Port 1 is reserved/unassigned — connection refused immediately.
    const urls = [
      "ws://127.0.0.1:1",
      `ws://127.0.0.1:${silentPort}`,
      `ws://127.0.0.1:${harness.port}`,
    ];
    let connectedUrl = "";
    let status = "";
    client = makeClient(urls, {
      onStatus: (s) => {
        status = s;
      },
      onConnected: (url) => {
        connectedUrl = url;
      },
    });
    client.start();
    await waitFor(() => status === "connected");
    expect(connectedUrl).toBe(`ws://127.0.0.1:${harness.port}`);
  });

  it("keeps cycling with backoff when no candidate answers, then connects", async () => {
    const silentPort = await startSilentServer();
    let connects = 0;
    let cycles = 0;
    client = makeClient([`ws://127.0.0.1:${silentPort}`], {
      onStatus: (s) => {
        if (s === "connected") connects += 1;
        if (s === "connecting") cycles += 1;
      },
      schedule: (fn) => setTimeout(fn, 5),
      // Short probe so two full scan cycles fit well inside the waitFor window.
      probeTimeoutMs: 250,
    });
    client.start();
    // At least two full scan cycles run without a connection — the client
    // never gives up while only non-reins listeners answer.
    await waitFor(() => cycles >= 2);
    expect(connects).toBe(0);
  });

  it("dispatches a request and replies with the result", async () => {
    harness = await startServer();
    let status = "";
    client = makeClient([`ws://127.0.0.1:${harness.port}`], {
      dispatch: async (method) => (method === "list_tabs" ? { tabs: [{ tabId: 1 }] } : {}),
      onStatus: (s) => {
        status = s;
      },
    });
    client.start();
    // Wait for the client to adopt the socket, not just for the server to see
    // hello — a probe timeout between the two abandons the socket and the
    // request below would go to a connection the client no longer serves.
    await waitFor(() => status === "connected");

    const response = await new Promise<Record<string, unknown>>((resolve) => {
      // biome-ignore lint/style/noNonNullAssertion: connected implies the server accepted hello, so current() is set
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
    let status = "";
    client = makeClient([`ws://127.0.0.1:${harness.port}`], {
      dispatch: async () => {
        throw new Error("boom");
      },
      onStatus: (s) => {
        status = s;
      },
    });
    client.start();
    await waitFor(() => status === "connected");

    const response = await new Promise<Record<string, unknown>>((resolve) => {
      // biome-ignore lint/style/noNonNullAssertion: connected implies the server accepted hello, so current() is set
      const ws = harness!.current()!;
      ws.on("message", (d: RawData) => {
        const m = JSON.parse(d.toString());
        if (m.type === "response") resolve(m);
      });
      ws.send(JSON.stringify({ type: "request", id: "r2", method: "x", params: {} }));
    });
    expect(response.ok).toBe(false);
    expect((response.error as { message: string }).message).toBe("boom");
    expect((response.error as { code: string }).code).toBe("HANDLER_ERROR");
  });

  it("uses err.code in the error frame when present", async () => {
    harness = await startServer();
    let status = "";
    client = makeClient([`ws://127.0.0.1:${harness.port}`], {
      dispatch: async () => {
        throw Object.assign(new Error("nope"), { code: "policy_denied" });
      },
      onStatus: (s) => {
        status = s;
      },
    });
    client.start();
    await waitFor(() => status === "connected");

    const response = await new Promise<Record<string, unknown>>((resolve) => {
      // biome-ignore lint/style/noNonNullAssertion: connected implies the server accepted hello, so current() is set
      const ws = harness!.current()!;
      ws.on("message", (d: RawData) => {
        const m = JSON.parse(d.toString());
        if (m.type === "response") resolve(m);
      });
      ws.send(JSON.stringify({ type: "request", id: "r3", method: "click", params: {} }));
    });
    expect(response.ok).toBe(false);
    expect(response.error).toEqual({ code: "policy_denied", message: "nope" });
  });

  it("abandons a probe whose welcome arrives late, then adopts the retry", async () => {
    // Regression for a CI flake: on a stalled runner the probe timer can fire
    // after the server accepted hello but before welcome is processed. The
    // client must drop that socket and succeed on the next cycle.
    let hellos = 0;
    let live: WebSocket | undefined;
    harness = await startServer();
    harness.server.removeAllListeners("connection");
    harness.server.on("connection", (ws) => {
      ws.on("message", (data: RawData) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === "hello") {
          hellos += 1;
          live = ws;
          const delay = hellos === 1 ? 200 : 0; // first welcome misses the 50ms probe
          setTimeout(() => ws.send(JSON.stringify({ type: "welcome", server: "reins" })), delay);
        }
      });
    });

    let status = "";
    client = makeClient([`ws://127.0.0.1:${harness.port}`], {
      dispatch: async () => ({ pong: true }),
      onStatus: (s) => {
        status = s;
      },
      probeTimeoutMs: 50,
      schedule: (fn) => setTimeout(fn, 5),
    });
    client.start();
    await waitFor(() => status === "connected");
    expect(hellos).toBeGreaterThanOrEqual(2);

    const response = await new Promise<Record<string, unknown>>((resolve) => {
      // biome-ignore lint/style/noNonNullAssertion: connected implies a live socket
      const ws = live!;
      ws.on("message", (d: RawData) => {
        const m = JSON.parse(d.toString());
        if (m.type === "response") resolve(m);
      });
      ws.send(JSON.stringify({ type: "request", id: "r-late", method: "ping", params: {} }));
    });
    expect(response).toMatchObject({ id: "r-late", ok: true, result: { pong: true } });
  });

  it("does not produce an unhandled rejection when the socket drops mid-dispatch", async () => {
    harness = await startServer();

    // Deferred dispatch: dispatch returns a promise we resolve manually after the socket closes.
    let resolveDispatch!: (v: unknown) => void;
    const dispatchInflight = new Promise<unknown>((res) => {
      resolveDispatch = res;
    });
    let dispatchCalled = false;
    // Latch: true once "disconnected" has been observed (avoids racing with fast reconnect).
    let sawDisconnected = false;
    let sawConnected = false;

    client = makeClient([`ws://127.0.0.1:${harness.port}`], {
      dispatch: async () => {
        dispatchCalled = true;
        return dispatchInflight;
      },
      onStatus: (s) => {
        if (s === "connected") sawConnected = true;
        if (s === "disconnected") sawDisconnected = true;
      },
      schedule: (fn) => setTimeout(fn, 5),
    });
    client.start();

    await waitFor(() => sawConnected);
    harness
      .current()
      ?.send(JSON.stringify({ type: "request", id: "r-drop", method: "slow", params: {} }));
    await waitFor(() => dispatchCalled);

    harness.current()?.close();
    await waitFor(() => sawDisconnected);

    resolveDispatch({ ok: true });
    await new Promise<void>((res) => setTimeout(res, 50));
    expect(sawDisconnected).toBe(true);
  });

  it("reconnects after the socket drops", async () => {
    harness = await startServer();
    let connects = 0;
    client = makeClient([`ws://127.0.0.1:${harness.port}`], {
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

  it("stop() cancels a pending reconnect — no overlapping sockets", async () => {
    harness = await startServer();

    let serverConnections = 0;
    harness.server.on("connection", () => {
      serverConnections += 1;
    });

    let pendingReconnect: (() => void) | undefined;

    client = makeClient([`ws://127.0.0.1:${harness.port}`], {
      schedule: (fn) => {
        pendingReconnect = fn;
      },
    });
    client.start();

    await waitFor(() => harness?.current() !== undefined);
    await waitFor(() => serverConnections >= 1);

    harness.current()?.close();
    await waitFor(() => pendingReconnect !== undefined);

    client.stop();
    client.start();
    await waitFor(() => serverConnections >= 2);

    pendingReconnect?.();
    await new Promise<void>((res) => setTimeout(res, 50));

    expect(serverConnections).toBe(2);
  });
});
