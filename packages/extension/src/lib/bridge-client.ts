import { nextBackoff } from "./backoff.js";

export type Dispatch = (method: string, params: unknown) => Promise<unknown>;
export type ConnectionStatus = "connecting" | "connected" | "disconnected";

/** The subset of the browser WebSocket API that BridgeClient uses. */
export interface SocketLike {
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev?: { code?: number }) => void) | null;
  onerror: ((err: unknown) => void) | null;
}

export interface WelcomeInfo {
  version?: string;
  browserId?: string;
}

export interface BridgeClientOptions {
  /** Candidate ws:// URLs, best guess first (sticky port, then the shared range). */
  urls: () => string[];
  browser: string;
  dispatch: Dispatch;
  createSocket: (url: string) => SocketLike;
  onStatus?: (status: ConnectionStatus) => void;
  /** Reports the URL that produced a welcome (persist its port for next
   *  time) plus the daemon's self-description from the welcome frame. */
  onConnected?: (url: string, welcome: WelcomeInfo) => void;
  /** Schedule a reconnect cycle; injectable for tests. Defaults to setTimeout. */
  schedule?: (fn: () => void, ms: number) => void;
  /** How long to wait per candidate for the welcome frame. */
  probeTimeoutMs?: number;
}

/**
 * Client half of the reins bridge with built-in daemon discovery: each
 * connect cycle walks the candidate URLs, sends `hello`, and adopts the
 * first socket that answers `welcome` (anything else on those ports closes
 * or stays silent and is skipped). Cycles repeat with exponential backoff
 * forever — the daemon may start long after the browser. Transport-agnostic
 * via `createSocket`.
 */
export class BridgeClient {
  readonly #opts: BridgeClientOptions;
  #socket: SocketLike | undefined;
  #attempt = 0;
  #stopped = false;
  #cycleToken = 0;

  constructor(opts: BridgeClientOptions) {
    this.#opts = opts;
  }

  start(): void {
    this.#stopped = false;
    void this.#cycle(this.#cycleToken);
  }

  stop(): void {
    this.#stopped = true;
    this.#cycleToken += 1;
    this.#socket?.close();
    this.#socket = undefined;
  }

  #schedule(fn: () => void, ms: number): void {
    (this.#opts.schedule ?? ((f, m) => void setTimeout(f, m)))(fn, ms);
  }

  async #cycle(token: number): Promise<void> {
    if (this.#stopped || token !== this.#cycleToken || this.#socket) return;
    this.#opts.onStatus?.("connecting");
    for (const url of this.#opts.urls()) {
      const probed = await this.#tryUrl(url);
      if (this.#stopped || token !== this.#cycleToken || this.#socket) {
        probed?.socket.close();
        return;
      }
      if (probed) {
        this.#adopt(probed.socket, url, probed.welcome);
        return;
      }
    }
    this.#opts.onStatus?.("disconnected");
    this.#attempt += 1;
    this.#schedule(() => void this.#cycle(token), nextBackoff(this.#attempt));
  }

  /** Open one candidate: resolves the welcomed socket, or null (closed/silent/timeout). */
  #tryUrl(url: string): Promise<{ socket: SocketLike; welcome: WelcomeInfo } | null> {
    return new Promise((resolve) => {
      let settled = false;
      let socket: SocketLike;
      try {
        socket = this.#opts.createSocket(url);
      } catch {
        resolve(null);
        return;
      }
      const settle = (welcome: WelcomeInfo | null) => {
        if (settled) return;
        settled = true;
        if (!welcome) {
          try {
            socket.close();
          } catch {
            // already closed
          }
        }
        resolve(welcome ? { socket, welcome } : null);
      };
      socket.onopen = () => {
        socket.send(JSON.stringify({ type: "hello", browser: this.#opts.browser }));
      };
      socket.onmessage = (ev) => {
        try {
          const msg = JSON.parse(String(ev.data)) as {
            type?: string;
            version?: string;
            browserId?: string;
          };
          if (msg.type === "welcome") {
            settle({ version: msg.version, browserId: msg.browserId });
          }
        } catch {
          // not a reins server — keep waiting for the timeout
        }
      };
      socket.onclose = () => settle(null);
      socket.onerror = () => settle(null);
      // Real timer on purpose: the injectable schedule() is for reconnect
      // cycles; a probe must time out on the wall clock.
      setTimeout(() => settle(null), this.#opts.probeTimeoutMs ?? 1500);
    });
  }

  #adopt(socket: SocketLike, url: string, welcome: WelcomeInfo): void {
    this.#socket = socket;
    this.#attempt = 0;
    socket.onmessage = (ev) => this.#onMessage(String(ev.data));
    socket.onclose = () => this.#onClose();
    socket.onerror = () => socket.close();
    this.#opts.onStatus?.("connected");
    this.#opts.onConnected?.(url, welcome);
  }

  #onClose(): void {
    if (!this.#socket) return; // stopped or already replaced
    this.#socket = undefined;
    this.#opts.onStatus?.("disconnected");
    if (this.#stopped) return;
    this.#attempt += 1;
    const token = this.#cycleToken;
    this.#schedule(() => void this.#cycle(token), nextBackoff(this.#attempt));
  }

  #onMessage(raw: string): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }
    if (msg.type === "request" && typeof msg.id === "string" && typeof msg.method === "string") {
      void this.#handleRequest(msg.id, msg.method, msg.params);
    }
  }

  async #handleRequest(id: string, method: string, params: unknown): Promise<void> {
    const socket = this.#socket;
    if (!socket) return;
    let result: unknown;
    let dispatchError: unknown;
    let threw = false;
    try {
      result = await this.#opts.dispatch(method, params);
    } catch (err) {
      threw = true;
      dispatchError = err;
    }
    if (this.#socket !== socket) return; // socket replaced/closed during dispatch
    try {
      if (!threw) {
        socket.send(JSON.stringify({ type: "response", id, ok: true, result }));
      } else {
        const message =
          dispatchError instanceof Error ? dispatchError.message : String(dispatchError);
        socket.send(
          JSON.stringify({
            type: "response",
            id,
            ok: false,
            error: { code: "HANDLER_ERROR", message },
          }),
        );
      }
    } catch {
      // Socket closed between dispatch and send; response cannot be delivered.
    }
  }
}
