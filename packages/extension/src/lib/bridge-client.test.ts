import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { type RawData, WebSocket, WebSocketServer } from "ws";
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

    client = new BridgeClient({
      url: `ws://127.0.0.1:${harness.port}`,
      token: TOKEN,
      browser: "test",
      dispatch: async () => {
        dispatchCalled = true;
        return dispatchInflight;
      },
      createSocket: nodeSocketFactory,
      onStatus: (s) => {
        if (s === "disconnected") sawDisconnected = true;
      },
      schedule: (fn) => setTimeout(fn, 5),
    });
    client.start();

    // Wait for server to receive hello (which sets current() and sends welcome).
    await waitFor(() => harness?.current() !== undefined);

    // Server sends a request; client will process welcome then this request in order.
    harness
      .current()
      ?.send(JSON.stringify({ type: "request", id: "r-drop", method: "slow", params: {} }));

    // Wait until dispatch has started (confirming welcome + request were both processed).
    await waitFor(() => dispatchCalled);

    // Close the server-side socket while dispatch is still in-flight.
    harness.current()?.close();

    // Wait for the client to observe disconnect (latch, so we don't race with fast reconnect).
    await waitFor(() => sawDisconnected);

    // Now resolve the dispatch — this must NOT produce an unhandled rejection.
    resolveDispatch({ ok: true });

    // Settle the microtask queue; Vitest fails the suite on any unhandled rejection.
    await new Promise<void>((res) => setTimeout(res, 50));

    expect(sawDisconnected).toBe(true);
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
