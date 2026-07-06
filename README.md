<p align="center">
  <img src="packages/extension/icons/icon.svg" width="96" alt="reins logo">
</p>

<h1 align="center">reins</h1>

<p align="center"><strong>Take the reins of your real browser from any coding agent.</strong></p>

<p align="center">
  <a href="https://reins.karnstack.com">reins.karnstack.com</a> ·
  <a href="https://reins.karnstack.com/docs">docs</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@karnstack/reins"><img src="https://img.shields.io/npm/v/%40karnstack%2Freins" alt="npm"></a>
  <a href="https://github.com/karnstack/reins/actions/workflows/ci.yml"><img src="https://github.com/karnstack/reins/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT"></a>
  <!-- Chrome Web Store badge once the extension ID exists:
  <a href="https://chromewebstore.google.com/detail/EXTENSION_ID"><img src="https://img.shields.io/chrome-web-store/v/EXTENSION_ID" alt="Chrome Web Store"></a>
  -->
</p>

reins gives agents (Claude Code, Cursor, Codex, Copilot, … — anything with a
shell) full control of your actual, logged-in Chromium browsers — Chrome,
Dia, Brave, Edge, Arc — through a CLI and a Manifest V3 extension. No MCP
server to register, no separate debug profile, no launch flags, no tokens:
install the CLI once, add the extension, install the skill, done.

## How it works

```
agent ── shell ──► reins CLI ── HTTP /rpc ──► reins daemon ◄── WS ── reins extension(s)
                   (auto-spawns the daemon)   (127.0.0.1)            │ chrome.debugger (CDP)
                                                                     ▼ your tabs
```

- The **CLI** is the whole interface: `reins tabs`, `reins click`,
  `reins screenshot`, … A **skill** teaches agents the commands.
- The **daemon** is invisible plumbing: any command starts it on demand; it
  holds the WebSocket the extensions dial into (one daemon, any number of
  browsers). `reins kill` stops it.
- The **extension** finds the daemon on its own (localhost port discovery)
  and authenticates by its unforgeable `chrome-extension://<id>` origin.

## Install

```bash
npm i -g @karnstack/reins        # the CLI (daemon included, starts on demand)
npx skills add karnstack/reins   # the skill, into your agent(s) of choice
# then install the reins extension (Chrome Web Store) → it connects on its own
```

That's the whole setup — no daemon to start, nothing to register per agent.
`reins status`, `reins browsers`, `reins tabs`, and `reins logs` show what's
connected; logs live in `~/.reins/logs/`.

## Commands

```
Tabs & pages   tabs · open <url> · close · focus · nav <url|back|forward|reload>
Interaction    snapshot · click · type · fill · select · press · hover ·
               scroll · upload · wait · dialog · resize
Reading        text · screenshot · console · network
Advanced       eval '<js>' · cdp <Domain.method> ['{json}'] · daemon
Management     browsers · status · allow <id> · kill · doctor · logs · help
```

The loop agents use: `reins snapshot` prints interactive elements with refs
(`e5: button "Submit"`) → act by ref (`reins click --ref e5`) → verify with
`reins text` or `reins screenshot` (prints an image path). Every command
takes `--tab <id>` (default: active tab), `--browser <id>` (only needed when
several browsers are connected — never guessed), and `--json`.

`reins cdp` is the escape hatch to the full Chrome DevTools Protocol —
cookies, geolocation, PDF, tracing — anything the curated commands don't
wrap.

## Develop

```bash
mise install        # Node 24.18.0 + pnpm 11.9.0 (exact, via mise)
pnpm install
pnpm dev            # watch-build all packages (extension → dist/)
pnpm test           # protocol + cli + extension unit/integration tests
pnpm lint && pnpm typecheck && pnpm build
pnpm daemon         # build + run the daemon in the foreground (Ctrl-C stops)
pnpm reins tabs     # build + run any CLI command
pnpm zip            # package the extension for the Chrome Web Store
```

Local walkthrough (load unpacked, allow the dev ID, drive tabs):
**[docs/RUNNING.md](docs/RUNNING.md)**. Releasing:
**[docs/RELEASING.md](docs/RELEASING.md)** ·
Chrome Web Store: **[docs/CHROME_WEB_STORE.md](docs/CHROME_WEB_STORE.md)**.

## Packages

- `packages/protocol` — shared zod frames + method schemas + port constants (`@reins/protocol`, private, bundled)
- `packages/cli` — CLI + daemon, published as [`@karnstack/reins`](https://www.npmjs.com/package/@karnstack/reins) (bin: `reins`)
- `packages/extension` — MV3 extension (Vite + crxjs)
- `packages/web` — landing page + docs at [reins.karnstack.com](https://reins.karnstack.com) (TanStack Start, prerendered, Cloudflare)
- `skills/reins` — the agent skill (`npx skills add karnstack/reins`)

## Security

- Everything binds `127.0.0.1` — nothing is reachable from the network.
- `/rpc` and the other endpoints validate the `Host` header (DNS-rebinding
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

- [`docs/superpowers/specs/2026-07-04-reins-cli-skill-design.md`](docs/superpowers/specs/2026-07-04-reins-cli-skill-design.md) — CLI + daemon + extension, discovery, multi-browser, page control, skill

## License

[MIT](LICENSE)
