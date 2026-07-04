# reins

**Take the reins of your real browser from your coding agent.**

reins lets MCP clients (Claude Code, Codex, Cursor, …) drive your actual,
logged-in Chromium browsers — Chrome, Dia, Brave, Edge, Arc — through a
Manifest V3 extension. No separate debug profile, no launch flags, no pairing
tokens: install the CLI once, add the extension, and every browser on your
machine that runs it becomes drivable.

## How it works

```
Claude Code ─┐  MCP (streamable HTTP, one session each)
Codex        ├──► /mcp ─┐
Cursor …    ─┘          │   reins daemon (127.0.0.1, launchd/systemd)
                        ├── localhost WebSocket (extension-ID pinned) ◄── reins extension(s)
   reins CLI ──► /health└─▸                                                 │ chrome.debugger (CDP)
                /browsers /tabs                                             ▼ your tabs
```

One daemon serves any number of MCP clients **and** any number of browsers
concurrently. The extension finds the daemon on its own (localhost port
discovery) and authenticates by its unforgeable `chrome-extension://<id>`
origin — pinned to an exact allowlist, no tokens to paste.

## Install

```bash
npm i -g @karnstack/reins
reins up                 # start the daemon + autostart on login (macOS/Linux)
reins install claude     # register the MCP endpoint with Claude Code
# then install the reins extension (Chrome Web Store) → it connects on its own
```

That's the whole setup. `reins status`, `reins browsers`, `reins tabs`, and
`reins logs` show what the daemon sees; logs live in `~/.reins/logs/`.

Other clients: `reins install` prints Codex TOML and generic JSON snippets.
Clients without streamable-HTTP support can run `npx -y @karnstack/reins
serve --stdio` instead (also the Windows path — no service management there
yet).

## Tools

| Tool | What it does |
|---|---|
| `list_tabs` | List tabs across **all** connected browsers (tagged `browserId`) |
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

Every tool takes an optional `browserId` (from `list_tabs`) — required only
when several browsers are connected, so the agent never guesses which browser
to drive. `read_console` / `read_network` start a persistent monitor on first
use; monitored tabs stay drivable (the per-call tools reuse the session).

## Develop

```bash
mise install        # Node 24.18.0 + pnpm 11.9.0 (exact, via mise)
pnpm install
pnpm dev            # watch-build all packages (extension → dist/)
pnpm test           # protocol + mcp + extension unit/integration tests
pnpm lint && pnpm typecheck && pnpm build
pnpm mcp            # build + run the daemon in the foreground (Ctrl-C stops)
pnpm reins status   # build + run any CLI command (tabs, doctor, logs, …)
pnpm zip            # package the extension for the Chrome Web Store
```

Local walkthrough (load unpacked, allow the dev ID, drive tabs):
**[docs/RUNNING.md](docs/RUNNING.md)**. Release process:
**[docs/PUBLISHING.md](docs/PUBLISHING.md)**.

## Packages

- `packages/protocol` — shared zod frames + tool schemas + port constants (`@reins/protocol`, private, bundled)
- `packages/mcp` — daemon + CLI, published as [`@karnstack/reins`](https://www.npmjs.com/package/@karnstack/reins) (bin: `reins`)
- `packages/extension` — MV3 extension (Vite + crxjs)

## Security

- Everything binds `127.0.0.1` — nothing is reachable from the network.
- `/mcp` and the status endpoints validate the `Host` header (DNS-rebinding
  protection), so web pages can't reach the daemon even via rebound DNS.
- The extension WebSocket is accepted only from exact allowlisted
  `chrome-extension://<id>` origins — browsers stamp that header themselves,
  so pages and other extensions can't forge it. Dev builds are added with
  `reins allow <id>`.
- `chrome.debugger` shows the native "is being debugged" banner while a
  command runs; the popup's **Disconnect** toggle is the kill switch.
- The extension collects nothing and talks to nothing but your local daemon —
  see [docs/PRIVACY.md](docs/PRIVACY.md).

## Design

- [`docs/superpowers/specs/2026-06-28-reins-design.md`](docs/superpowers/specs/2026-06-28-reins-design.md) — bridge protocol + tools
- [`docs/superpowers/specs/2026-07-04-reins-daemon-design.md`](docs/superpowers/specs/2026-07-04-reins-daemon-design.md) — daemon, discovery, multi-browser

## License

[MIT](LICENSE)
