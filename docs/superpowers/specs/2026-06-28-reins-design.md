# reins — Design Spec

**Date:** 2026-06-28
**Status:** Approved (design), pending implementation plan
**Repo:** `~/code/karnstack/reins`

## 1. Summary

`reins` lets a coding agent (Claude Code, Codex — any MCP stdio client) drive a
user's **real, already-logged-in** Chromium browser. A Manifest V3 extension
attaches to tabs via `chrome.debugger` (Chrome DevTools Protocol) and executes
commands relayed from a local MCP server over an authenticated localhost
WebSocket.

It exists because the external-CDP path (`--remote-debugging-port` +
`chrome-devtools-mcp`) hits real walls on modern Chromium: launch-flag-only
remote debugging, the Chrome 136+ default-profile block, the M146 per-session
Allow dialog, rotating `DevToolsActivePort` GUIDs, and browsers (e.g. Dia) that
disable the `/json` discovery endpoints. An in-browser extension sidesteps all
of them: it runs inside the user's normal browser, on the real profile, with no
launch flags.

### Goals
- Drive the user's live, logged-in browser from an MCP client.
- Work on any Chromium (Chrome, Dia, Brave, Edge, Arc) — load the extension, done.
- Playwright-grade capability (CDP), not a thin DOM shim.
- Reusable, open-source, one-line install for Claude Code and Codex.

### Non-goals (v1)
- Firefox / WebKit.
- Externally controlling browsers without the extension installed.
- Chrome Web Store publication (load-unpacked for v1; store later).
- Performance traces / emulation / throttling (chrome-devtools-mcp parity).

## 2. Architecture

```
Claude Code / Codex
   │  stdio (MCP / JSON-RPC)
   ▼
reins-mcp        Node/TS — stdio MCP server + localhost WS host + `reins` CLI
   │  WebSocket  ws://127.0.0.1:<port>   (token-authed, origin-checked)
   ▼
reins-extension  MV3 — any Chromium
   │  chrome.debugger (CDP)
   ▼
the live tab     (user's real logged-in profile)
```

### Components (one responsibility each)

| Package | Responsibility | Depends on |
|---|---|---|
| `packages/protocol` | Versioned zod schemas for bridge request/response/event frames + shared TS types. Pure, no IO. Single source of truth for both sides and for MCP input schemas. | — |
| `packages/mcp` | stdio MCP server: defines the 13 tools, hosts the localhost WS, pairing/token, maps tool call → bridge request, enforces timeouts, formats results (screenshots → MCP image content). Ships the `reins` CLI. Published to npm as `reins-mcp`. | protocol |
| `packages/extension` | MV3 extension: offscreen-doc-held WS client, token auth, `chrome.debugger` attach + CDP execution per tool, tab↔debuggee mapping, console/network ring buffers, reconnect, popup UI (status, pair, kill switch). | protocol |

**Isolation rationale:** `mcp` knows nothing about CDP (only emits bridge
requests); `extension` knows nothing about MCP (only executes bridge requests);
`protocol` is the contract both compile against, so they cannot drift. Each is
testable alone.

### Repo layout (Turborepo + pnpm workspaces)

```
reins/
  packages/
    protocol/      # tsdown-built lib; zod schemas + types
    mcp/           # tsdown-built; MCP server + `reins` CLI  → npm: reins-mcp
    extension/     # vite + @crxjs/vite-plugin → dist/ (load unpacked)
  docs/superpowers/specs/
  .github/workflows/ci.yml
  mise.toml        # pins node + pnpm (exact)
  turbo.json
  pnpm-workspace.yaml
  biome.json
  package.json
  README.md
```

## 3. Toolchain (exact pins, no ranges / no "latest")

Versions current as of 2026-06-28; re-verify at scaffold and pin literally in
`package.json` + `mise.toml`.

| Tool | Version |
|---|---|
| Node (LTS, Krypton) | 24.18.0 |
| pnpm | 11.9.0 |
| TypeScript | 6.0.3 |
| tsdown (lib build) | 0.22.3 |
| vite (extension) | 8.1.0 |
| @crxjs/vite-plugin | 2.7.0 |
| vitest | 4.1.9 |
| turbo | 2.10.0 |
| zod | 4.4.3 |
| @modelcontextprotocol/sdk | 1.29.0 |
| ws | 8.21.0 |
| @types/node | 26.0.1 |
| @types/chrome | 0.2.0 |
| @biomejs/biome | 2.5.1 |

**Risk:** `@crxjs/vite-plugin` may lag Vite 8. Verify compatibility at scaffold;
if incompatible, pin Vite to the highest version crxjs supports and record why.

## 4. Data flow & lifecycle

### Pairing (one-time)
1. `reins-mcp` boots, binds `ws://127.0.0.1:<port>`, generates a 256-bit token,
   writes `~/.reins/{port,token}` (chmod 600).
2. User opens the extension popup once and pastes URL + token (or runs
   `reins pair`, which prints them). Stored in `chrome.storage.local`.
3. Extension dials the WS, sends `{type:"hello", token, browser}`; server
   validates token **and** `Origin: chrome-extension://<id>`, replies
   `{type:"welcome"}`. Auto-reconnect with backoff on drop.

### Tool-call lifecycle (example: `click`)
```
agent → MCP click{ref,tabId?}
  → reins-mcp: zod-validate, assign id, send {id,method:"click",params} over WS
    → extension: ensure chrome.debugger attached to tab
                 resolve ref → CDP getBoxModel → Input.dispatchMouseEvent press/release
                 reply {id,result}
  → reins-mcp: per-request timeout; map to MCP result (image → content block)
→ agent
```

### Console / network (pull model)
On attach, the extension subscribes to CDP `Runtime.consoleAPICalled` and
`Network.*`, buffering into bounded ring buffers per tab. `read_console` /
`read_network` drain/filter the buffer. Simpler and cheaper than streaming
events to the agent.

### Tab model
Every tool accepts optional `tabId`; default = active tab of the focused window.
The `tabs` tools list/open/close/select. The extension maintains a
`tabId ↔ debuggee` map and lazily attaches on first command per tab.

### MV3 service-worker death (highest-risk module)
Service workers are killed after ~30s idle, which would drop the WS and the
debugger session. Mitigation:
- The long-lived WS lives in an **offscreen document** (persists beyond the
  worker). The worker proxies `chrome.*` calls to/from it via `chrome.runtime`
  messaging.
- `chrome.alarms` heartbeat keeps things warm.
- `chrome.debugger` attachments are re-established on demand if detached.
This module is isolated behind an interface and gets dedicated tests + a manual
soak test (idle > 30s, then issue a command).

## 5. Tool surface (v1 — 13 tools)

All take optional `tabId` (default = active tab of focused window). `read_snapshot`
returns stable element `ref` ids; `click`/`type`/`wait_for` accept `ref` or `selector`.

| Tool | Params | Returns | CDP |
|---|---|---|---|
| `list_tabs` | — | `[{tabId,title,url,active}]` | chrome.tabs |
| `open_tab` | `{url, activate?}` | `{tabId}` | chrome.tabs |
| `close_tab` | `{tabId}` | `{ok}` | chrome.tabs |
| `select_tab` | `{tabId}` | `{ok}` | chrome.tabs.update |
| `navigate` | `{tabId?, to}` (url \| back\|forward\|reload) | `{url,status}` | Page.navigate |
| `read_snapshot` | `{tabId?, mode:text\|a11y\|dom, maxChars?}` | snapshot + `ref` ids | Accessibility / DOMSnapshot |
| `click` | `{tabId?, ref\|selector, button?, clickCount?}` | `{ok}` | Input.dispatchMouseEvent |
| `type` | `{tabId?, ref?\|selector?, text, submit?}` | `{ok}` | Input.insertText / key events |
| `wait_for` | `{tabId?, selector\|ref, state:visible\|hidden\|present, timeoutMs?}` | `{ok}` | DOM poll |
| `eval_js` | `{tabId?, expression, awaitPromise?}` | `{result}` | Runtime.evaluate |
| `screenshot` | `{tabId?, fullPage?, format?}` | image content block | Page.captureScreenshot |
| `read_console` | `{tabId?, sinceMs?, levels?}` | `[entries]` | Runtime.consoleAPICalled (ring) |
| `read_network` | `{tabId?, sinceMs?, filter?}` | `[requests]` (headers redacted) | Network.* (ring) |

Each tool = one bridge `method`. Params/returns are zod schemas in
`packages/protocol`, reused directly as MCP input schemas.

## 6. Security model

- **Localhost-only:** WS binds `127.0.0.1`, never `0.0.0.0`.
- **Pairing token:** 256-bit random, required in `hello`; unauthenticated
  sockets rejected. `~/.reins/token` chmod 600; rotate via `reins pair --rotate`.
  Token only in frame body, never in a URL/query.
- **Origin check:** accept only `Origin: chrome-extension://<id>`; reject page
  origins. Prevents a malicious web page's JS from connecting to the local WS.
- **Visible by design:** `chrome.debugger` forces the native "browser is being
  debugged" banner; never hidden. Popup has a connection indicator + one-click
  "disconnect / detach all" kill switch.
- **Domain policy:** **allow-all by default + optional user blocklist** for
  sensitive domains. (Chosen over allowlist/prompt to avoid the friction the
  user disliked; banner + kill switch remain the safety net.)
- **Sensitive data:** `eval_js` / `read_network` can expose cookies, auth
  headers, page secrets to the agent. README states this plainly;
  `read_network` redacts auth headers by default (opt-out flag).

## 7. Error handling

- Every bridge request has `id` + timeout (default 30s, per-tool override);
  timeout → MCP `isError` result with context.
- Extension faults (debugger detached, tab gone, CDP error) return structured
  `{error:{code,message}}` → MCP error result.
- `"Another debugger already attached"` (DevTools open on the tab) → explicit
  "close DevTools on that tab" message.
- WS drop: in-flight requests reject immediately (no stale queue); extension
  auto-reconnects with backoff. On tab close / kill switch, `chrome.debugger`
  detaches cleanly.
- `eval_js` exceptions and rejected promises are surfaced, not swallowed.
- Pairing failures (bad token, wrong origin) return clear, actionable messages.

## 8. Testing

- **protocol** — vitest unit: schema round-trip + validation (valid/invalid frames).
- **mcp** — vitest unit with a mock WS bridge: tool→frame mapping, timeout
  behavior, result/image formatting, pairing/token + origin checks.
- **extension** — vitest unit: CDP-mapping logic and offscreen/worker messaging
  against a mocked `chrome.debugger` / `chrome.runtime`.
- **e2e smoke** (gated; local + CI-headful via Playwright): launch Chromium with
  the unpacked extension, run a fake MCP client against a local fixture page,
  exercise navigate→snapshot→click→type→screenshot end-to-end.
- **manual soak** — idle the worker > 30s, then issue a command (validates the
  offscreen/keepalive design).

## 9. CI / release

- **CI (GitHub Actions):** mise + pnpm install → biome lint → `tsc` typecheck →
  vitest → `turbo build`. e2e job headful (xvfb) or marked allow-failure initially.
- **Release:** changesets for `reins-mcp` (npm); extension built to a versioned
  zip artifact. Web Store listing deferred.

## 10. Setup UX (documented in README)

- Build/load the extension unpacked (`chrome://extensions` → Load unpacked →
  `packages/extension/dist`).
- Claude Code: `claude mcp add reins -- npx -y reins-mcp`.
- Codex: `~/.codex/config.toml` `[mcp_servers.reins]`.
- `reins` CLI: `pair` (print url+token), `status`, `doctor` (port/link/browser).

## 11. Milestones

1. **M0 — scaffold:** monorepo (turbo/pnpm/mise/biome/tsconfig), three empty
   packages building + lint + test green in CI.
2. **M1 — bridge:** protocol schemas; `reins-mcp` WS host + pairing; extension
   offscreen WS client + auth; `hello/welcome` handshake; `reins doctor`.
3. **M2 — core driving:** `list_tabs`/`open_tab`/`navigate`/`read_snapshot`/
   `click`/`type` over `chrome.debugger`; e2e smoke green.
4. **M3 — power tools:** `wait_for`, `eval_js`, `screenshot`, `read_console`,
   `read_network`; ring buffers; header redaction.
5. **M4 — hardening:** worker-death soak, reconnect, blocklist, kill switch,
   docs, `reins-mcp` v0.1 npm release.

## 12. Open risks

- `@crxjs/vite-plugin` ↔ Vite 8 compatibility (see §3).
- `chrome.debugger` exposes tab-level CDP only (no browser-wide `Target`/`Browser`
  domains) — tool set is designed within that constraint.
- Per-Chromium quirks (Dia/Arc) in `chrome.debugger` behavior — validate during M2.
- MV3 offscreen-doc longevity across browsers — the soak test is the gate.
