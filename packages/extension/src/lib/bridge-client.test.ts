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
    probeTimeoutMs: 250,
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
    });
    client.start();
    // At least two full scan cycles run without a connection — the client
    // never gives up while only non-reins listeners answer.
    await waitFor(() => cycles >= 2);
    expect(connects).toBe(0);
  });

  it("dispatches a request and replies with the result", async () => {
    harness = await startServer();
    client = makeClient([`ws://127.0.0.1:${harness.port}`], {
      dispatch: async (method) => (method === "list_tabs" ? { tabs: [{ tabId: 1 }] } : {}),
    });
    client.start();
    await waitFor(() => harness?.current() !== undefined);

    const response = await new Promise<Record<string, unknown>>((resolve) => {
      // biome-ignore lint/style/noNonNullAssertion: harness and current() are confirmed non-null by waitFor
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
    client = makeClient([`ws://127.0.0.1:${harness.port}`], {
      dispatch: async () => {
        throw new Error("boom");
      },
    });
    client.start();
    await waitFor(() => harness?.current() !== undefined);

    const response = await new Promise<Record<string, unknown>>((resolve) => {
      // biome-ignore lint/style/noNonNullAssertion: harness and current() are confirmed non-null by waitFor
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

    client = makeClient([`ws://127.0.0.1:${harness.port}`], {
      dispatch: async () => {
        dispatchCalled = true;
        return dispatchInflight;
      },
      onStatus: (s) => {
        if (s === "disconnected") sawDisconnected = true;
      },
      schedule: (fn) => setTimeout(fn, 5),
    });
    client.start();

    await waitFor(() => harness?.current() !== undefined);
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
