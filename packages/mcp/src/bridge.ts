import { randomUUID, timingSafeEqual } from "node:crypto";
import type { AddressInfo } from "node:net";
import { HelloFrame, RequestFrame, ResponseFrame, WelcomeFrame } from "@reins/protocol";
import { type RawData, WebSocket, WebSocketServer } from "ws";
import type { Log } from "./log.js";

/** Constant-time token comparison (localhost-only, but cheap to do right). */
function tokenMatches(candidate: string, expected: string): boolean {
  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

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
  readonly #log: Log;
  #wss: WebSocketServer | undefined;
  #client: WebSocket | undefined;
  readonly #pending = new Map<string, Pending>();

  constructor(opts: { port: number; token: string; allowedOriginPrefix?: string; log?: Log }) {
    this.#requestedPort = opts.port;
    this.#token = opts.token;
    this.#originPrefix = opts.allowedOriginPrefix ?? "chrome-extension://";
    this.#log = opts.log ?? ((message) => process.stderr.write(`${message}\n`));
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const wss = new WebSocketServer({ host: "127.0.0.1", port: this.#requestedPort });
      wss.on("listening", () => {
        this.#log(`reins-mcp: bridge listening on 127.0.0.1:${this.port}`);
        resolve();
      });
      wss.on("error", (err) => {
        // Don't retain a server that never bound (e.g. EADDRINUSE) — avoids a leak on retry.
        this.#wss = undefined;
        reject(err);
      });
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
    this.#log(`reins-mcp: connection from origin=${origin}`);
    if (!origin?.startsWith(this.#originPrefix)) {
      this.#log(`reins-mcp: rejected: origin not allowed (${origin})`);
      ws.close(4003, "origin not allowed");
      return;
    }
    let authed = false;
    ws.on("message", (data) => {
      const msg = this.#parse(data);
      if (!msg) return;
      if (!authed) {
        const hello = HelloFrame.safeParse(msg);
        if (hello.success && tokenMatches(hello.data.token, this.#token)) {
          authed = true;
          if (this.#client && this.#client !== ws && this.#client.readyState === WebSocket.OPEN) {
            this.#log("reins-mcp: client replaced by new connection");
            this.#client.close(4002, "replaced by a new connection");
          }
          this.#client = ws;
          const browser = hello.data.browser;
          this.#log(`reins-mcp: authed${browser ? ` (browser=${browser})` : ""}`);
          ws.send(JSON.stringify(WelcomeFrame.parse({ type: "welcome", server: "reins" })));
        } else {
          this.#log("reins-mcp: rejected: bad token");
          ws.close(4001, "bad token");
        }
        return;
      }
      const response = ResponseFrame.safeParse(msg);
      if (response.success) {
        this.#settle(response.data.id, response.data);
      }
    });
    ws.on("close", (code) => {
      this.#log(`reins-mcp: connection closed (code=${code})`);
      if (this.#client === ws) {
        this.#client = undefined;
        // Spec §7: fail fast — don't leave in-flight requests hanging to timeout.
        this.#rejectAllPending("extension disconnected");
      }
    });
  }

  #rejectAllPending(message: string): void {
    for (const [, pending] of this.#pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error(message));
    }
    this.#pending.clear();
  }

  #parse(data: RawData): Record<string, unknown> | undefined {
    try {
      const v = JSON.parse(data.toString());
      return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : undefined;
    } catch {
      return undefined;
    }
  }

  #settle(id: string, frame: ResponseFrame): void {
    const pending = this.#pending.get(id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.#pending.delete(id);
    if (frame.ok === true) {
      pending.resolve(frame.result);
    } else {
      const err = frame.error ?? { code: "ERR", message: "request failed" };
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
      try {
        client.send(JSON.stringify(RequestFrame.parse({ type: "request", id, method, params })));
      } catch (err) {
        // Sync send failure (socket closing, bad frame): clean up so the timer
        // doesn't keep the process alive and the pending map doesn't leak.
        clearTimeout(timer);
        this.#pending.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
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
    return new Promise((resolve) => wss.close(() => resolve()));
  }
}
