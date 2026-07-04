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
capture events from that point on. The per-call tools detect a monitored tab
and reuse its debugger session, so a monitored tab stays drivable.

## Install (users)

```bash
# 1. register the MCP server with Claude Code
npx -y --package=reins-mcp reins install claude
#    (Codex/other clients: npx -y --package=reins-mcp reins install)

# 2. install the reins extension (Chrome Web Store, or a release zip via
#    chrome://extensions → Load unpacked)

# 3. pair the browser: print the URL + token, paste into the extension popup
npx -y --package=reins-mcp reins pair
```

The server starts automatically with your MCP client, logs to
`~/.reins/logs/`, and shuts down with it. `reins status`, `reins doctor`, and
`reins logs` help when something looks off.

## Develop

```bash
mise install        # Node 24.18.0 + pnpm 11.9.0 (exact, via mise)
pnpm install
pnpm dev            # watch-build all packages (extension → dist/)
pnpm test           # protocol + mcp + extension unit/integration tests
pnpm lint && pnpm typecheck && pnpm build
pnpm mcp            # build + run the MCP server on stdio (Ctrl-C to stop)
pnpm reins pair     # build + run any CLI command (status, doctor, logs, …)
pnpm zip            # package the extension for the Chrome Web Store
```

Local walkthrough (load unpacked, pair, try tools): **[docs/RUNNING.md](docs/RUNNING.md)**.
Release process (npm + Chrome Web Store): **[docs/PUBLISHING.md](docs/PUBLISHING.md)**.

## Packages

- `packages/protocol` — shared zod bridge + tool schemas (`@reins/protocol`, private, bundled into reins-mcp)
- `packages/mcp` — MCP server + `reins` CLI (published to npm as [`reins-mcp`](https://www.npmjs.com/package/reins-mcp))
- `packages/extension` — MV3 extension (Vite + crxjs)

## Security

- The WebSocket binds `127.0.0.1` only and requires both a pairing token and a
  `chrome-extension://` origin; a bad token is rejected without an infinite
  retry loop.
- `chrome.debugger` shows the native "browser is being debugged" banner while a
  command runs; the popup's **Disconnect** button is the kill switch.
- Pairing material lives in `~/.reins` (token file mode `0600`).
- The extension collects nothing and talks to nothing but your local server —
  see [docs/PRIVACY.md](docs/PRIVACY.md).

## Design

See [`docs/superpowers/specs/2026-06-28-reins-design.md`](docs/superpowers/specs/2026-06-28-reins-design.md).

## License

[MIT](LICENSE)
