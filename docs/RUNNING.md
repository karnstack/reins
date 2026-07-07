# Running reins locally (from source)

reins has two halves:

- **the CLI** (`reins <command>`) — the whole user/agent interface; it
  auto-spawns a small local daemon that hosts the extension WebSocket and a
  JSON `/rpc` endpoint on one localhost port.
- **the extension** — an MV3 extension that discovers the daemon and executes
  commands in your browser.

> Just want to use it? `npm i -g @karnstack/reins`, install the extension
> from the [Chrome Web Store](https://chromewebstore.google.com/detail/reins/hnjcfgochepemjndccfblpmfmlblkofo),
> and `npx skills add karnstack/reins` for your agent. This document is the
> from-source developer walkthrough.

## 1. Prerequisites & build

```bash
mise install          # Node 24.18.0 + pnpm 11.9.0
pnpm install
pnpm build            # builds all three packages
```

This produces:
- `packages/cli/dist/cli.js` — the `reins` CLI (daemon = `reins daemon`)
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

## 3. Drive it

```bash
pnpm reins tabs       # first command auto-spawns the daemon, then lists tabs
pnpm reins snapshot --tab <id>
pnpm reins click --ref e1 --tab <id>
```

The daemon picks a port automatically (8765, walking to 8774 if busy),
records it in `~/.reins/port`, and logs to `~/.reins/logs/daemon-<date>.log`.
The extension scans the same range and connects on its own — the toolbar
popover turns green and shows the daemon version, port, and this browser's
id (e.g. `b1 (Chrome)`).

To debug the daemon itself, run it in the foreground: `pnpm daemon`
(Ctrl-C stops it). `pnpm reins kill` stops a background one.

## 4. Hook up an agent

`npx skills add karnstack/reins` installs the skill from this repo (or point
your agent at `skills/reins/SKILL.md` directly). Since the interface is just
a CLI on PATH, any agent with a shell can use it — no per-agent registration.

## Troubleshooting

- **Popover stays "Disconnected":** daemon not running (`reins status` —
  any tool command starts it), or the dev extension ID isn't allowlisted
  (`reins allow <id>`, then `reins kill` — it respawns on demand).
- **Port collisions:** none, normally — the daemon walks 8765–8774 and the
  extension + CLI discover it. `REINS_PORT=<port>` pins an exact port for
  everything (no walking); the popover's Advanced section can pin the
  extension too.
- **`no browser connected`:** the extension isn't installed/allowed in any
  open browser, or it's still reconnecting (up to ~10 s after a daemon
  restart). `reins doctor` shows what's reachable.
- **Anything else:** `reins logs` tails the newest daemon log.
