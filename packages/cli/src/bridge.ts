import { randomUUID } from "node:crypto";
import type { Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import {
  type BrowserInfo,
  CALL_METHODS,
  CallFrame,
  HelloFrame,
  RequestFrame,
  ResponseFrame,
  type ResponseMeta,
  WelcomeFrame,
} from "@reins/protocol";
import { type RawData, WebSocket, WebSocketServer } from "ws";
import type { Log } from "./log.js";
import { packageVersion } from "./version.js";

export interface RequestOpts {
  browserId?: string;
  timeoutMs?: number;
}

/** A settled bridge request: the result plus the extension-stamped action
 *  target and the browser that served it — everything the audit trail needs. */
export interface BridgeReply {
  result: unknown;
  meta?: ResponseMeta;
  browserId: string;
}

export interface BridgePort {
  readonly paired: boolean;
  readonly browsers: BrowserInfo[];
  request(method: string, params: unknown, opts?: RequestOpts): Promise<unknown>;
  requestFull(method: string, params: unknown, opts?: RequestOpts): Promise<BridgeReply>;
}

interface Pending {
  resolve: (value: BridgeReply) => void;
  reject: (reason: Error) => void;
  timer: NodeJS.Timeout;
  browserId: string;
}

interface ConnectedBrowser {
  ws: WebSocket;
  browser: string;
  connectedAt: number;
  version?: string;
}

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Server half of the reins bridge. Any number of browsers connect
 * concurrently (one connection per running browser). Each is authenticated
 * by its WebSocket Origin header — an exact `chrome-extension://<id>` match
 * against the allowlist. Browsers stamp that header themselves, so web pages
 * and other extensions cannot forge it; see the 2026-07-04 daemon spec.
 */
export class BridgeHost implements BridgePort {
  readonly #allowedOrigins: ReadonlySet<string>;
  readonly #log: Log;
  #wss: WebSocketServer | undefined;
  #ownServer = false;
  #nextBrowserId = 1;
  readonly #browsers = new Map<string, ConnectedBrowser>();
  readonly #pending = new Map<string, Pending>();
  readonly #onCall?: (method: string, params: unknown, browserId: string) => Promise<unknown>;

  constructor(opts: {
    allowedOrigins: ReadonlySet<string>;
    log?: Log;
    onCall?: (method: string, params: unknown, browserId: string) => Promise<unknown>;
  }) {
    this.#allowedOrigins = opts.allowedOrigins;
    this.#log = opts.log ?? ((message) => process.stderr.write(`${message}\n`));
    this.#onCall = opts.onCall;
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
        // Don't retain a server that never bound (e.g. EADDRINUSE) — avoids a leak on retry.
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

  get paired(): boolean {
    return this.browsers.length > 0;
  }

  /** Connected browsers, oldest first. */
  get browsers(): BrowserInfo[] {
    return [...this.#browsers.entries()]
      .filter(([, b]) => b.ws.readyState === WebSocket.OPEN)
      .map(([id, b]) => ({
        id,
        browser: b.browser,
        connectedAt: b.connectedAt,
        ...(b.version !== undefined ? { version: b.version } : {}),
      }));
  }

  #onConnection(ws: WebSocket, origin: string | undefined): void {
    this.#log(`reins: connection from origin=${origin}`);
    if (!this.#originAllowed(origin)) {
      // listen() mode has no pre-upgrade gate, so enforce here too.
      this.#log(`reins: rejected: origin not allowed (${origin})`);
      ws.close(4003, "origin not allowed");
      return;
    }
    let browserId: string | undefined;
    ws.on("message", (data) => {
      const msg = this.#parse(data);
      if (!msg) return;
      if (browserId === undefined) {
        const hello = HelloFrame.safeParse(msg);
        if (!hello.success) {
          this.#log("reins: rejected: malformed hello");
          ws.close(4001, "malformed hello");
          return;
        }
        browserId = `b${this.#nextBrowserId++}`;
        this.#browsers.set(browserId, {
          ws,
          browser: hello.data.browser,
          connectedAt: Date.now(),
          ...(hello.data.version !== undefined ? { version: hello.data.version } : {}),
        });
        this.#log(`reins: browser connected (${browserId}: ${hello.data.browser})`);
        ws.send(
          JSON.stringify(
            WelcomeFrame.parse({
              type: "welcome",
              server: "reins",
              version: packageVersion(),
              browserId,
            }),
          ),
        );
        return;
      }
      const response = ResponseFrame.safeParse(msg);
      if (response.success) {
        this.#settle(response.data.id, response.data);
        return;
      }
      const call = CallFrame.safeParse(msg);
      if (call.success) void this.#answerCall(ws, browserId, call.data);
    });
    ws.on("close", (code) => {
      this.#log(`reins: connection closed (${browserId ?? "unauthed"}, code=${code})`);
      if (browserId !== undefined && this.#browsers.delete(browserId)) {
        // Spec §7: fail fast — don't leave in-flight requests hanging to timeout.
        this.#rejectPendingFor(browserId, "browser disconnected");
      }
    });
  }

  /** Extension → daemon: only the key methods, answered with a ResponseFrame. */
  async #answerCall(ws: WebSocket, browserId: string, frame: CallFrame): Promise<void> {
    let reply: ResponseFrame;
    if (!this.#onCall || !(CALL_METHODS as readonly string[]).includes(frame.method)) {
      reply = {
        type: "response",
        id: frame.id,
        ok: false,
        error: {
          code: "METHOD_NOT_ALLOWED",
          message: `${frame.method} can't be called from the extension`,
        },
      };
    } else {
      try {
        const result = await this.#onCall(frame.method, frame.params, browserId);
        reply = { type: "response", id: frame.id, ok: true, result };
      } catch (err) {
        reply = {
          type: "response",
          id: frame.id,
          ok: false,
          error: { code: "CALL_FAILED", message: err instanceof Error ? err.message : String(err) },
        };
      }
    }
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(reply));
  }

  #rejectPendingFor(browserId: string, message: string): void {
    for (const [id, pending] of this.#pending) {
      if (pending.browserId !== browserId) continue;
      clearTimeout(pending.timer);
      pending.reject(new Error(message));
      this.#pending.delete(id);
    }
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
      pending.resolve({ result: frame.result, meta: frame.meta, browserId: pending.browserId });
    } else {
      const err = frame.error ?? { code: "ERR", message: "request failed" };
      const e = new Error(`${err.code}: ${err.message}`) as Error & {
        code?: string;
        meta?: ResponseMeta;
        browserId?: string;
      };
      e.code = err.code;
      e.meta = frame.meta;
      e.browserId = pending.browserId;
      pending.reject(e);
    }
  }

  /** Pick the target browser: explicit id, or the only one connected. */
  #resolveBrowser(browserId: string | undefined): { id: string; ws: WebSocket } {
    const live = this.browsers;
    const roster = live.map((b) => `${b.id} (${b.browser})`).join(", ");
    if (browserId !== undefined) {
      const entry = this.#browsers.get(browserId);
      if (!entry || entry.ws.readyState !== WebSocket.OPEN) {
        throw new Error(
          `unknown browserId "${browserId}"${roster ? `. Connected: ${roster}` : ". No browsers connected"}`,
        );
      }
      return { id: browserId, ws: entry.ws };
    }
    if (live.length === 0) throw new Error("extension not connected");
    if (live.length > 1) {
      throw new Error(`several browsers connected. Pass browserId. Connected: ${roster}`);
    }
    const only = live[0] as BrowserInfo;
    const entry = this.#browsers.get(only.id) as ConnectedBrowser;
    return { id: only.id, ws: entry.ws };
  }

  requestFull(method: string, params: unknown, opts: RequestOpts = {}): Promise<BridgeReply> {
    let target: { id: string; ws: WebSocket };
    try {
      target = this.#resolveBrowser(opts.browserId);
    } catch (err) {
      return Promise.reject(err);
    }
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const id = randomUUID();
    return new Promise<BridgeReply>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        const e = new Error(`request "${method}" timed out after ${timeoutMs}ms`) as Error & {
          browserId?: string;
        };
        e.browserId = target.id;
        reject(e);
      }, timeoutMs);
      this.#pending.set(id, { resolve, reject, timer, browserId: target.id });
      try {
        target.ws.send(JSON.stringify(RequestFrame.parse({ type: "request", id, method, params })));
      } catch (err) {
        // Sync send failure (socket closing, bad frame): clean up so the timer
        // doesn't keep the process alive and the pending map doesn't leak.
        clearTimeout(timer);
        this.#pending.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  request(method: string, params: unknown, opts: RequestOpts = {}): Promise<unknown> {
    return this.requestFull(method, params, opts).then((r) => r.result);
  }

  stop(): Promise<void> {
    this.#rejectAllPending("bridge stopped");
    this.#browsers.clear();
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
