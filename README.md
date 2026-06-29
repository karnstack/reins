# reins

**Take the reins of your real browser from your coding agent.**

reins lets an MCP client (Claude Code, Codex, …) drive your actual, logged-in
Chromium browser — Chrome, Dia, Brave, Edge, Arc — through a Manifest V3
extension. No separate debug profile, no launch flags: you pair your everyday
browser once and your agent can read and act on the pages you're already
signed into.

## How it works

```
Claude Code / Codex
   │  MCP (stdio)
   ▼
reins-mcp ── localhost WebSocket (token + origin authed) ── reins extension ── chrome.debugger (CDP) ── your tabs
```

The MCP server hosts a localhost WebSocket; the extension connects out to it
(no inbound port on the browser), authenticates with a pairing token, and runs
commands via the Chrome DevTools Protocol from inside an offscreen document.

## Tools

| Tool | What it does |
|---|---|
| `list_tabs` | List open tabs (id, title, url, active) |
| `open_tab` / `close_tab` / `select_tab` | Open, close, and focus tabs |
| `navigate` | Go to a URL, or `back` / `forward` / `reload` |
| `read_snapshot` | Snapshot interactive/labelled elements, each with a `ref` |
| `click` | Click an element by `ref` (from a snapshot) or CSS selector |
| `type` | Type into an element; optionally press Enter |
| `screenshot` | Capture the page as an image |
| `eval_js` | Evaluate JavaScript in the page and return the value |
| `wait_for` | Wait for an element to be visible / hidden / present |
| `read_console` | Read recent console messages (level, text) for a tab |
| `read_network` | Read recent network requests (method, url, status) for a tab |

`read_console` / `read_network` start a persistent monitor on first use, so they
capture events from that point on; a monitored tab can't be driven by the
per-call tools at the same time (one debugger per tab).

## Quick start

Full walkthrough: **[docs/RUNNING.md](docs/RUNNING.md)**. In short:

```bash
mise install && pnpm install && pnpm build
claude mcp add reins -- node "$(pwd)/packages/mcp/dist/server.js"
# chrome://extensions → Load unpacked → packages/extension/dist
node packages/mcp/dist/cli.js pair    # paste URL + token into the popup → Connect
# then ask your agent to call list_tabs, navigate, click, …
```

## Packages

- `packages/protocol` — shared zod bridge + tool schemas (`@reins/protocol`)
- `packages/mcp` — MCP server + `reins` CLI (`reins-mcp`)
- `packages/extension` — MV3 extension (Vite + crxjs)

## Develop

```bash
mise install        # Node 24.18.0 + pnpm 11.9.0 (exact, via mise)
pnpm install
pnpm test           # protocol + mcp + extension unit/integration tests
pnpm lint && pnpm typecheck && pnpm build
```

## Security

- The WebSocket binds `127.0.0.1` only and requires both a pairing token and a
  `chrome-extension://` origin; a bad token is rejected without an infinite
  retry loop.
- `chrome.debugger` shows the native "browser is being debugged" banner while a
  command runs; the popup's **Disconnect** button is the kill switch.
- Pairing material lives in `~/.reins` (token file mode `0600`).

## Design

See [`docs/superpowers/specs/2026-06-28-reins-design.md`](docs/superpowers/specs/2026-06-28-reins-design.md).
