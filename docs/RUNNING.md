# Running reins locally (from source)

reins has two halves:

- **the daemon** (`reins serve`) — hosts the MCP endpoint (streamable HTTP)
  and the extension WebSocket on one localhost port.
- **the extension** — an MV3 extension that discovers the daemon and executes
  commands in your browser.

> Just want to use it? `npm i -g @karnstack/reins && reins up && reins
> install claude`, then install the extension from the Chrome Web Store.
> This document is the from-source developer walkthrough.

## 1. Prerequisites & build

```bash
mise install          # Node 24.18.0 + pnpm 11.9.0
pnpm install
pnpm build            # builds all three packages
```

This produces:
- `packages/mcp/dist/cli.js` — the `reins` CLI (daemon = `reins serve`)
- `packages/extension/dist/` — the loadable unpacked extension

While iterating, `pnpm dev` watch-builds all packages instead.

## 2. Load the extension and allow its dev ID

1. Open `chrome://extensions` (or `dia://extensions` etc.).
2. Enable **Developer mode** → **Load unpacked** → select `packages/extension/dist`.
3. Copy the extension's **ID** from the card, then:

```bash
pnpm reins allow <that-id>
```

(Unpacked builds get a per-machine ID; the published store build is
allowlisted out of the box.)

## 3. Start the daemon

```bash
pnpm mcp              # foreground daemon; Ctrl-C stops it
# or: node packages/mcp/dist/cli.js up   (background service + autostart)
```

The daemon picks a port automatically (8765, walking to 8774 if busy),
records it in `~/.reins/port`, and logs to `~/.reins/logs/mcp-<date>.log`.
The extension scans the same range and connects on its own — the toolbar
popover turns green and shows the daemon version, port, and this browser's
id (e.g. `b1 (Chrome)`).

## 4. Register with your agent

```bash
node packages/mcp/dist/cli.js install claude
# or by hand:
claude mcp add --transport http reins http://127.0.0.1:8765/mcp --scope user
```

`reins install` discovers the live port automatically. Codex / other
clients: `reins install` prints the snippets. stdio fallback:
`node packages/mcp/dist/cli.js serve --stdio` (don't run it while the daemon
holds the same port — the CLI will tell you).

## 5. Try it

```bash
node packages/mcp/dist/cli.js status     # daemon + connected browsers
node packages/mcp/dist/cli.js tabs      # every tab the daemon can reach
```

Then ask your agent to call `list_tabs` — tabs come back tagged with
`browserId` per connected browser; the other tools take that `browserId` when
more than one browser is connected.

## Troubleshooting

- **Popover stays "Disconnected":** daemon not running (`reins status`), or
  the dev extension ID isn't allowlisted (`reins allow <id>`, then
  `reins restart`).
- **Port collisions:** none, normally — the daemon walks 8765–8774 and the
  extension + CLI discover it. `REINS_PORT=<port>` pins an exact port for
  everything (no walking); the popover's Advanced section can pin the
  extension too.
- **Agent config points at a stale port:** ports are sticky across restarts,
  but if the daemon had to move, re-run `reins install claude`.
  `reins doctor` shows what's reachable.
- **Anything else:** `reins logs` tails the newest server log.
