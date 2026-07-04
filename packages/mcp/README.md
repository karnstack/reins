# reins-mcp

**Drive your real, logged-in browser from an MCP client.**

`reins-mcp` is the server half of [reins](https://github.com/karnstack/reins):
an MCP (stdio) server that exposes browser tools — `list_tabs`, `navigate`,
`click`, `type`, `screenshot`, `eval_js`, `read_console`, `read_network`, and
more — and relays them over a localhost WebSocket to the reins Chrome
extension running in your everyday browser. No separate debug profile, no
launch flags.

## Install

**Claude Code** (one command):

```bash
npx -y --package=reins-mcp reins install claude
```

or manually:

```bash
claude mcp add reins --scope user -- npx -y reins-mcp
```

**Codex** (`~/.codex/config.toml`):

```toml
[mcp_servers.reins]
command = "npx"
args = ["-y", "reins-mcp"]
```

**Any other MCP client** (JSON config):

```json
{ "mcpServers": { "reins": { "command": "npx", "args": ["-y", "reins-mcp"] } } }
```

## Pair the browser

1. Install the **reins** extension (Chrome Web Store, or load unpacked from
   the [repo](https://github.com/karnstack/reins)).
2. Print the pairing details:

   ```bash
   npx -y --package=reins-mcp reins pair
   ```

3. Click the reins toolbar icon, paste the URL + token, hit **Connect**.

## CLI

```
reins install [claude|codex]  register the MCP server with an agent
reins pair                    print the WebSocket URL + token
reins status                  config, port, server up/down
reins doctor                  diagnostic checks
reins logs                    show ~/.reins/logs location + recent lines
```

The server starts automatically with your MCP client and logs to
`~/.reins/logs/mcp-<date>.log`. Pairing material lives in `~/.reins` (token
file mode 0600). The WebSocket binds `127.0.0.1` only and requires both the
pairing token and a `chrome-extension://` origin.

MIT © [karnstack](https://github.com/karnstack/reins)
