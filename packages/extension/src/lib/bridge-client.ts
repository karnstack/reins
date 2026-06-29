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
        JSON.stringify({
          type: "response",
          id,
          ok: false,
          error: { code: "HANDLER_ERROR", message },
        }),
      );
    }
  }
}
