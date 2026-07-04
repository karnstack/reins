# reins daemon: one CLI, HTTP transport, zero-touch pairing

**Date:** 2026-07-04
**Status:** approved (design), implementation pending
**Supersedes:** the stdio-only transport story in `2026-06-28-reins-design.md` (bridge protocol and tool semantics from that spec remain in force).

## Problem

Today every MCP client spawns its own `reins-mcp` over stdio. That means:

- one client at a time (the WS bridge port is exclusive),
- per-client plumbing (`claude mcp add` / TOML / JSON with paths),
- a copy-paste pairing dance (URL + token into the popup),
- no single place to manage the server (start/stop/logs/status).

## Goal — the whole UX

```bash
npm i -g @karnstack/reins
reins up                 # daemon on 127.0.0.1:8765 + autostart on login
reins install claude     # register HTTP MCP endpoint with Claude Code
# install the reins extension from the Chrome Web Store
# → extension auto-connects to the daemon; popup pill turns green. Done.
```

No tokens to paste. Multiple MCP clients (Claude Code, Codex, Cursor, …) can
connect concurrently. Logs live in `~/.reins/logs/`.

## Decisions (made with Karn, 2026-07-04)

1. **Package:** `@karnstack/reins`, single bin named `reins`. The `reins-mcp`
   package name is retired (never published). Version starts at 0.2.0.
2. **Daemon management:** OS user service — launchd agent on macOS, systemd
   user unit on Linux. Windows unsupported in v1 (stdio mode still works).
3. **Transports:** streamable HTTP (daemon, default) **and** stdio fallback
   (`reins serve --stdio`) for clients without HTTP support.
4. **No bearer token on `/mcp`:** localhost bind + strict Host/Origin
   validation (DNS-rebinding protection) is the defense that matters; a token
   adds friction, not security, against local processes (see Security).
5. **No pairing token at all:** the extension is authenticated by its
   unforgeable `chrome-extension://<id>` WebSocket `Origin`, pinned to an
   exact-ID allowlist. The extension auto-connects.

## Architecture

One process, one port:

```
Claude Code ─┐  streamable HTTP (session per client)
Codex        ├──► POST/GET/DELETE /mcp ─┐
Cursor …    ─┘                          │
                       127.0.0.1:8765   ├─ shared BridgeHost ── WS upgrade ◄── reins extension
              GET /health ──────────────┘                        (origin = pinned extension ID)
```

- **`reins serve`** (foreground; what launchd/systemd runs): binds a Node
  `http.Server` to `127.0.0.1:<port>` (default 8765, `REINS_PORT` override).
  - `POST/GET/DELETE /mcp` — SDK `StreamableHTTPServerTransport`, one
    `McpServer` (via the existing `createServer(bridge)`) per MCP session;
    sessions tracked by the SDK session ID and torn down on close/DELETE.
    `enableDnsRebindingProtection` with `allowedHosts` =
    `127.0.0.1:<port>`, `localhost:<port>`.
  - `GET /health` — `{ ok: true, version, paired }` (no side effects).
  - **WS upgrade** — `BridgeHost` refactored to attach to the existing HTTP
    server (`WebSocketServer({ noServer: true })` + `upgrade` handler)
    instead of owning a port. Everything else about the bridge (request/
    response frames, timeouts, replace-on-reconnect, fail-fast on disconnect)
    is unchanged.
- **`reins serve --stdio`** — today's stdio entry, kept for HTTP-less clients
  and Windows. Not for use alongside a running daemon on the same port (the
  bridge port is exclusive; the existing EADDRINUSE message explains).

## Extension authentication (replaces pairing)

- `HelloFrame.token` is removed from the protocol (`{ type: "hello",
  browser }`). Never published, so no compatibility shim needed.
- The bridge accepts a WS connection iff its `Origin` is exactly
  `chrome-extension://<id>` for an allowlisted id:
  - the published reins extension ID (constant in the daemon, filled in after
    first Chrome Web Store publish), plus
  - ids from `~/.reins/allowed-extensions` (one per line), managed by
    `reins allow <extension-id>` (needed for unpacked dev builds, which get
    per-machine ids).
- The extension auto-connects to `ws://127.0.0.1:8765` on install, browser
  start, and via its existing backoff loop (retry forever; backoff grows
  500ms → capped at 10s, since the daemon may start long after the browser). Popup becomes: status pill,
  Connect/Disconnect toggle (persisted as `autoConnect` in
  `chrome.storage.local`), and an advanced port field for non-default ports.
  `pairing.ts` (URL + token storage) is replaced by this settings object.

## Security model

- Bind `127.0.0.1` only, never configurable to a public interface.
- **Web pages** cannot reach the daemon: browsers send the true `Origin` on
  WS handshakes (exact-ID pinning rejects them) and DNS-rebinding protection
  on `/mcp` rejects requests whose `Host` isn't the local endpoint.
- **Rogue browser extensions** present their own extension ID as origin —
  rejected by exact-ID matching (prefix matching is not enough and is
  explicitly replaced).
- **Local processes running as the user** are out of scope: they could always
  read `~/.reins`, so no localhost auth scheme defends against them. This is
  unchanged from the stdio design (a local process could spawn the server
  itself).
- Chrome's native "is being debugged" banner + the popup Disconnect toggle
  remain the user-visible control and kill switch.

## CLI surface (single bin `reins`)

| Command | Does |
|---|---|
| `up` | write + load launchd agent / systemd user unit (autostart, restart-on-crash), start now |
| `down` | stop + unload + remove the service |
| `restart` | restart the service (post-upgrade) |
| `serve [--stdio]` | run the server in the foreground (HTTP daemon by default; stdio transport with the flag) |
| `install [claude\|codex]` | `claude`: run `claude mcp add --transport http reins http://127.0.0.1:<port>/mcp --scope user`; `codex`/none: print HTTP + stdio snippets |
| `allow <extension-id>` | append id to `~/.reins/allowed-extensions` (dev builds) |
| `status` | daemon up? (GET /health) → version, paired, port; service loaded? |
| `doctor` | config dir, port reachable/owned, service state, extension connected |
| `logs [-f]` | print newest `~/.reins/logs` file (+ follow) |
| `version` / `help` | as today |

`reins pair` is removed. `~/.reins/token` is no longer read or written
(existing files are ignored).

Service files (generated, absolute paths from `process.execPath` + resolved
`cli.js`):

- macOS: `~/Library/LaunchAgents/com.karnstack.reins.plist` — `RunAtLoad`,
  `KeepAlive`, `StandardErrorPath ~/.reins/logs/daemon.err.log`.
- Linux: `~/.config/systemd/user/reins.service` — `Restart=on-failure`, then
  `systemctl --user enable --now reins`.

## File layout (`~/.reins/`)

```
port                  informational, written by the daemon on start
allowed-extensions    optional, one extension id per line
logs/mcp-<date>.log   server log (existing logger)
logs/daemon.err.log   crash/stderr capture from the service manager
```

## Testing

- Unit: service-file generation (plist/unit content), allowlist parsing,
  exact-origin matching, `/health` payload, session create/teardown on the
  HTTP transport.
- Integration (vitest, ephemeral port): fake extension (ws client with a
  `chrome-extension://test` origin allowlisted) + real MCP HTTP client from
  the SDK → `initialize`, `tools/list`, `list_tabs` round-trip; two
  concurrent MCP sessions sharing one bridge; rejected cases: wrong `Host`
  on `/mcp`, non-allowlisted WS origin.
- Manual (documented in RUNNING.md): `reins up` on macOS, extension unpacked
  + `reins allow`, green pill, drive from Claude Code.

## Port auto-discovery (added 2026-07-04, approved)

The port is no longer a fixed contract:

- **Shared constants** (in `@reins/protocol`): `DEFAULT_PORT = 8765`,
  `PORT_RANGE = 10` → candidate ports 8765–8774.
- **Daemon (and stdio bridge)**: sticky port selection — prefer the port
  recorded in `~/.reins/port` (if in no-conflict shape), else walk the
  candidate range and bind the first free port; record the bound port.
  `REINS_PORT` forces an exact port (no walk, fail hard if busy).
- **Extension**: probes candidates over WS (hello → welcome within a short
  timeout identifies a real reins server; no extra permissions needed),
  trying the last-good port first (cached in `chrome.storage.local`). The
  bridge client gives up after a few reconnect attempts on a dead port and
  triggers a rescan.
- **CLI**: `reins install` locates the live daemon via `GET /health` across
  the candidates and bakes the found URL into the client config; `reins
  status`/`doctor` report the discovered port.
- **Known limitation**: MCP clients hold a baked URL. If the daemon drifts to
  a new port, re-run `reins install <client>`; stickiness makes drift rare.

## Multi-browser (added 2026-07-04, approved — core to the architecture)

One daemon serves **any number of browsers on the machine** concurrently
(Chrome + Brave + Dia each running the extension = three live connections).

- **Bridge**: keeps a map of connected browsers (`b1`, `b2`, … assigned per
  connection; entry removed on close — reconnect gets a fresh id). Each entry
  records the `browser` name from the hello frame. `paired` = at least one
  connected. Replace-on-reconnect (4002) is gone.
- **Routing**: every tool gains an optional `browserId` param. Resolution:
  explicit id → that browser (unknown id = error naming the live ones);
  omitted + exactly one browser → it; omitted + zero → "no browser
  connected"; omitted + several → error listing connected browsers so the
  agent can retry with `browserId`. Deterministic — never guess a browser.
- **`list_tabs`**: with `browserId` filters to that browser; without it
  aggregates across all browsers, each tab tagged `browserId` + `browser`.
- **Daemon endpoints** (all localhost + Host-validated, GET):
  `/browsers` → connected browsers; `/tabs` → the aggregated tab list.
- **CLI**: `reins browsers` and `reins tabs [browserId]` render those
  endpoints — visibility into what the daemon can reach.
- **Extension**: sends its real browser name in `hello.browser` (via
  `navigator.userAgentData` brands, falling back to `"browser"`). Otherwise
  unchanged — one connection per running browser.
- **Host validation everywhere**: `/health`, `/browsers`, `/tabs` get the
  same Host allowlist as `/mcp` (a DNS-rebound page must not read tab URLs).

## Out of scope (v1)

- Windows service management (stdio mode is the Windows path).
- TLS / non-localhost access / remote MCP.
- Auto-update of the daemon.

## Migration / renames

- `packages/mcp` package.json → name `@karnstack/reins`, bins collapse to
  `reins`. README/RUNNING/PUBLISHING and the npm README rewritten around
  `reins up`. Extension popup strings updated (no token field).
- The `release` workflow publishes `@karnstack/reins` (scoped ⇒ keep
  `--access public`).
