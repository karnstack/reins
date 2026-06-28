import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
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
    if (!origin?.startsWith(this.#originPrefix)) {
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
          if (this.#client && this.#client !== ws && this.#client.readyState === WebSocket.OPEN) {
            this.#client.close(4002, "replaced by a new connection");
          }
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

  #settle(id: string, msg: Record<string, unknown>): void {
    const pending = this.#pending.get(id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.#pending.delete(id);
    if (msg.ok === true) {
      pending.resolve(msg.result);
    } else {
      const err = (msg.error ?? { code: "ERR", message: "request failed" }) as {
        code: string;
        message: string;
      };
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
    this.#rejectAllPending("bridge stopped");
    this.#client = undefined;
    const wss = this.#wss;
    this.#wss = undefined;
    if (!wss) return Promise.resolve();
    for (const ws of wss.clients) ws.terminate();
    return new Promise((resolve) => wss.close(() => resolve()));
  }
}
