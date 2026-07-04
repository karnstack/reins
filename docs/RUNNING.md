# Running reins locally

reins lets an MCP client (Claude Code, Codex) drive your real, logged-in
Chromium browser. It has two halves:

- **`reins-mcp`** — a stdio MCP server that hosts a localhost WebSocket and
  exposes the browser tools.
- **the extension** — an MV3 extension that connects to that WebSocket and
  executes commands in your browser.

> Just want to use it? See the **Install** section of the
> [README](../README.md) — `npx -y --package=reins-mcp reins install claude`.
> This document is the from-source walkthrough.

## 1. Prerequisites & build

```bash
mise install          # Node 24.18.0 + pnpm 11.9.0
pnpm install
pnpm build            # builds all three packages
```

This produces:
- `packages/mcp/dist/server.js` — the MCP server
- `packages/mcp/dist/cli.js` — the `reins` CLI
- `packages/extension/dist/` — the loadable unpacked extension

While iterating, `pnpm dev` watch-builds all packages instead.

## 2. Register the MCP server with your agent

**Claude Code:**

```bash
claude mcp add reins -- node "$(pwd)/packages/mcp/dist/server.js"
```

**Codex** (`~/.codex/config.toml`):

```toml
[mcp_servers.reins]
command = "node"
args = ["/absolute/path/to/reins/packages/mcp/dist/server.js"]
```

On first start the server creates `~/.reins/{token,port}` (token is 32 random
bytes, file mode 0600), binds `ws://127.0.0.1:8765`, and logs to
`~/.reins/logs/mcp-<date>.log`.

## 3. Load the extension

1. Open `chrome://extensions` (or `dia://extensions` etc.).
2. Enable **Developer mode**.
3. **Load unpacked** → select `packages/extension/dist`.

## 4. Pair the browser

Print the pairing details:

```bash
pnpm reins pair
# WebSocket URL : ws://127.0.0.1:8765
# Token        : <token>
```

Click the reins toolbar icon, paste the **URL** and **token**, and hit
**Connect**. The status pill turns green ("Connected") once the extension
authenticates.

(`pnpm reins doctor` checks the config; `pnpm reins status` shows the port and
whether a server is running; `pnpm reins logs` tails the server log.)

## 5. Try it

Ask your agent to call the `list_tabs` tool — it returns the live tabs of your
paired browser (`tabId`, `title`, `url`, `active`).

## Security notes

- The server binds `127.0.0.1` only; the extension must present the pairing
  token and a `chrome-extension://` origin.
- A bad token closes the connection (no infinite retry) and surfaces an
  "Auth failed" status in the popup.
- `chrome.debugger` shows the native "being debugged" banner while attached.
  The popup's **Disconnect** is the kill switch.

## Troubleshooting

- **Port already in use:** another `reins-mcp` is running (the default port is
  fixed at 8765 — one MCP client at a time). Stop the other client or override
  with `REINS_PORT`. Stale servers no longer linger: the server exits when its
  MCP client disconnects.
- **Popup says "Auth failed":** re-run `pnpm reins pair` and paste the current
  token (the token rotates only if `~/.reins/token` is deleted/regenerated).
- **Something else:** `pnpm reins logs` shows the server's recent log lines.
