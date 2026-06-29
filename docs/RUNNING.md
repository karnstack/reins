# Running reins locally

reins lets an MCP client (Claude Code, Codex) drive your real, logged-in
Chromium browser. It has two halves:

- **`reins-mcp`** — a stdio MCP server that hosts a localhost WebSocket and
  exposes browser tools (currently `list_tabs`).
- **the extension** — an MV3 extension that connects to that WebSocket and
  executes commands in your browser.

> Status: the `list_tabs` loop is implemented. Driving tools (`click`, `type`,
> `navigate`, `screenshot`, …) land in M2.

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
bytes, file mode 0600) and binds `ws://127.0.0.1:8765`.

## 3. Load the extension

1. Open `chrome://extensions` (or `dia://extensions` etc.).
2. Enable **Developer mode**.
3. **Load unpacked** → select `packages/extension/dist`.

## 4. Pair the browser

Print the pairing details:

```bash
node packages/mcp/dist/cli.js pair
# WebSocket URL : ws://127.0.0.1:8765
# Token        : <token>
```

Click the reins toolbar icon, paste the **URL** and **token**, and hit
**Connect**. The status pill turns green ("Connected") once the extension
authenticates.

(`reins doctor` checks the config; `reins status` shows the configured port.)

## 5. Try it

Ask your agent to call the `list_tabs` tool — it returns the live tabs of your
paired browser (`tabId`, `title`, `url`, `active`).

## Security notes

- The server binds `127.0.0.1` only; the extension must present the pairing
  token and a `chrome-extension://` origin.
- A bad token closes the connection (no infinite retry) and surfaces an
  "Auth failed" status in the popup.
- The extension uses `chrome.debugger` in later milestones, which shows the
  native "being debugged" banner. The popup's **Disconnect** is the kill switch.

## Troubleshooting

- **Port already in use:** another `reins-mcp` is running (the default port is
  fixed at 8765). Stop the other client or override with `REINS_PORT`.
- **Popup says "Auth failed":** re-run `reins pair` and paste the current token
  (the token rotates only if `~/.reins/token` is deleted/regenerated).
