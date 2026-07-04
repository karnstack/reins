# reins CLI + skill design (MCP removed)

Date: 2026-07-04
Status: approved (supersedes the MCP surface of `2026-07-04-reins-daemon-design.md`;
the daemon/discovery/multi-browser parts of that spec stay in force)

## Decision

Drop the MCP server. reins becomes a **CLI-first browser-control tool**
taught to agents through a **skill** instead of registered with each agent as
an MCP server:

```
before   agent ── MCP HTTP ──► daemon ── WS ──► extension        (+ reins install per agent)
after    agent ── shell ──► reins CLI ── HTTP /rpc ──► daemon ── WS ──► extension
```

The daemon cannot be removed — extensions cannot listen on sockets, so a
local rendezvous process must hold the WebSocket — but it shrinks to a thin
bridge + JSON-RPC endpoint, and its lifecycle becomes invisible: the CLI
auto-spawns it on demand. OS service management (launchd/systemd) is deleted.

User setup becomes:

```bash
npm i -g @karnstack/reins        # CLI (daemon inside, auto-spawns on first use)
npx skills add karnstack/reins   # skill → Claude Code, Cursor, Codex, Copilot, …
# + reins extension in the browser(s) → connects on its own
```

No `reins up`, no `reins install <agent>`, no per-agent registration.

## What is removed

- `@modelcontextprotocol/sdk` dependency, `/mcp` endpoint, session handling.
- `create-server.ts` MCP tool definitions (the `listAllTabs` aggregation and
  the `browserId` routing move into the daemon's `/rpc` handler).
- `serve --stdio` mode.
- `service.ts` (launchd/systemd), `reins up|down|restart`.
- `reins install claude|codex` and the snippet builders in `cli-commands.ts`.
- `/browsers` and `/tabs` HTTP endpoints (CLI uses `/health` for the roster
  and `/rpc list_tabs` for tabs).

Migration for existing MCP registrations: `claude mcp remove reins` (one-off;
pre-launch, no external users).

## Daemon (kept, shrunk)

Everything from the daemon spec stays except the MCP layer:

- Binds `127.0.0.1`, sticky port (`~/.reins/port`) + walk 8765–8774,
  `REINS_PORT` pins exact. Logs to `~/.reins/logs/daemon-<date>.log`
  (renamed from `mcp-<date>.log` with the package move).
- WS upgrade for the extension, exact `chrome-extension://<id>` origin
  allowlist (`reins allow <id>` for dev builds, `PUBLISHED_EXTENSION_IDS`
  baked in).
- **Host-header validation on every route** (DNS-rebinding defense) — `/rpc`
  is exactly the kind of endpoint it protects.

Endpoints:

- `GET /health` → `{ ok, version, paired, browsers }` (unchanged).
- `POST /rpc` → body `{ method: string, params?: object }`; `params` may
  carry `browserId`, which the daemon splits off for routing (same rule as
  today: explicit id / single browser / ambiguity error listing the roster).
  `list_tabs` is special-cased to aggregate across all connected browsers and
  tag each tab with `browserId`/`browser`. Replies
  `200 { result }` or `502 { error }` (bridge/tool errors) /
  `400 { error }` (malformed body).
- `POST /shutdown` → daemon closes cleanly, replies `200 { ok: true }`.

Run modes:

- `reins daemon` — foreground (the only way the daemon runs; listed under an
  "advanced" section of help). `serve.ts` becomes this command's runner.
- Lazy spawn — every CLI command that needs the daemon first probes the
  candidate ports for `/health`; if none answers, it spawns
  `process.execPath cli.js daemon` detached (`stdio: "ignore"`, `unref()`;
  the daemon writes its own log file), then polls `/health` until it answers
  (timeout ~3 s → error pointing at `reins logs`).

Singleton guard (two CLI invocations racing to spawn): after binding, the
daemon probes the other candidate ports; if another live daemon answers on a
**lower** port, it logs and exits — deterministic: the lower-port daemon
always wins, at most one survives.

Browser-wait UX: if this CLI invocation just spawned the daemon, tool
commands wait up to 15 s for the first browser to appear in `/health` (the
extension's reconnect backoff caps at 10 s). If the daemon was already
running with zero browsers, fail fast:
`no browser connected — is the reins extension installed? (reins status)`.

Windows side effect: lazy spawn works there too (`detached` +
`windowsHide`), so Windows moves from "unsupported (no service)" to
best-effort supported.

## CLI surface

Zero-dependency flag parser (small hand-rolled `parseArgs` helper, unit
tested). Global flags on every tool command: `--browser <id>` (only needed
with >1 browser), `--tab <id>` (defaults to the active tab), `--json` (raw
result JSON; default output is compact readable text). Errors go to stderr,
exit code 1.

### Tool commands (existing bridge methods)

| Command | Bridge method | Notes |
|---|---|---|
| `reins tabs` | `list_tabs` | aggregated, `b1:12 ✓ Title — url` lines |
| `reins open <url> [--background]` | `open_tab` | prints new tab id |
| `reins close --tab <id>` | `close_tab` | |
| `reins focus --tab <id>` | `select_tab` | |
| `reins nav <url\|back\|forward\|reload>` | `navigate` | prints final URL |
| `reins snapshot [--mode a11y\|dom\|text] [--max-chars N]` | `read_snapshot` | content + ref list |
| `reins click (--ref e5 \| --selector css) [--button right\|middle] [--count 2]` | `click` | button/count already in schema |
| `reins type (--ref \| --selector) --text "…" [--enter]` | `type` | `--enter` → `submit: true` |
| `reins screenshot [--full] [--format jpeg] [--out path]` | `screenshot` | CLI decodes base64, writes file (default `~/.reins/shots/<ts>.png`), prints absolute path — agent Reads it |
| `reins eval '<js>' [--await]` | `eval_js` | prints value as JSON |
| `reins wait (--ref \| --selector) [--state visible\|hidden\|present] [--timeout ms]` | `wait_for` | |
| `reins console [--since ms] [--level error --level warn]` | `read_console` | one line per entry |
| `reins network [--since ms] [--url pattern]` | `read_network` | one line per entry |

### Tool commands (new bridge methods)

| Command | New bridge method | Extension implementation |
|---|---|---|
| `reins press --key "Escape"` | `press_key` | `Input.dispatchKeyEvent`; key spec `[Meta+\|Ctrl+\|Alt+\|Shift+]<Key>`, mapping table for Enter/Escape/Tab/Arrow*/Backspace/Delete/Home/End/PageUp/PageDown + printable chars |
| `reins hover (--ref \| --selector)` | `hover` | resolve node → scrollIntoView → `Input.dispatchMouseEvent` mousemove at center |
| `reins scroll [--ref \| --selector \| --by dx,dy \| --to top\|bottom]` | `scroll` | `Runtime.evaluate`: `scrollIntoView` / `window.scrollBy` / scroll to edge |
| `reins fill (--ref \| --selector) --value "…"` | `fill` | focus node, set value via native setter (React-compatible), dispatch `input`+`change` |
| `reins select (--ref \| --selector) --value "…"` | `select_option` | set `<select>` value, dispatch `change` |
| `reins upload (--ref \| --selector) --file <path> [--file <path>…]` | `upload` | `DOM.setFileInputFiles` (CLI resolves paths to absolute first) |
| `reins text [--ref \| --selector] [--max-chars N]` | `read_text` | `innerText` of element or `document.body`, truncated — the "read the page" primitive (snapshot only lists interactive elements) |
| `reins resize --width 1280 --height 800 [--clear]` | `resize` | `Emulation.setDeviceMetricsOverride` / `clearDeviceMetricsOverride` |
| `reins dialog (--accept \| --dismiss) [--text "…"]` | `handle_dialog` | `Page.handleJavaScriptDialog` on the open dialog; error if none open |
| `reins cdp <Domain.method> [json-params]` | `cdp` | raw `chrome.debugger.sendCommand` passthrough — the escape hatch that makes the surface "basically CDP": drag, cookies, geolocation, PDF, tracing, … |

All new methods get zod param/result schemas in `@reins/protocol` alongside
the existing ones (same `browserId`/`tabId` optional fields), handlers in the
extension (`dispatch.ts` cases + lib functions), and unit tests on both
sides.

`cdp` and `eval` are documented as the same trust domain as today: local,
user-installed, the debugger banner shows while attached, the popover's
Disconnect is the kill switch. No new security surface beyond what `eval_js`
already grants.

### Management commands

```
browsers   roster from /health          allow <id>   allowlist a dev extension id
status     daemon + browsers summary    kill         POST /shutdown to the live daemon
doctor     diagnostics                  daemon       run the daemon in the foreground
logs       tail newest log              version / help
```

## Skill

`skills/reins/SKILL.md` at the repo root — the skills.sh convention
(`skills/<name>/SKILL.md`, one level deep), so
`npx skills add karnstack/reins` discovers and installs it across supported
agents (Claude Code, Cursor, Codex, Copilot, Windsurf, Gemini, Cline, …).

Frontmatter:

```yaml
---
name: reins
description: Control the user's real, logged-in browser from the shell — list tabs, click, type, screenshot, read pages, run JS and raw CDP — via the reins CLI. Use when asked to interact with, test, or scrape a live webpage in the user's browser.
---
```

Body (lean — agents read the whole file): prerequisite check
(`reins status`, install hint if missing), the core loop (`tabs` →
`snapshot` → act on `--ref` → verify with `text`/`screenshot`), command
reference, multi-browser (`--browser` from `tabs` output), dialogs,
`eval`/`cdp` escape hatches, troubleshooting (`doctor`, `logs`,
`allow <id>`). No versioned install steps — the skill assumes the CLI is on
PATH and says how to get it if not.

## Repo changes

- `packages/mcp` → **`packages/cli`** (npm name stays `@karnstack/reins`,
  bin stays `reins`). Root scripts: `pnpm reins <cmd>` stays; `pnpm mcp`
  becomes `pnpm daemon` (foreground daemon).
- `skills/reins/SKILL.md` added.
- Extension: code untouched except popup hint copy (drop `reins up`,
  reference `reins status` / `reins allow`).
- Docs rewritten (README, RUNNING, PUBLISHING, PRIVACY): pitch shifts from
  "MCP server" to "browser skill for any agent"; PUBLISHING gains the
  skills.sh note (no registration — installable from the repo path as soon
  as it's public); PRIVACY rewords "MCP daemon" → "local daemon installed by
  the reins CLI".

## Testing

- Protocol: schema tests for the 10 new methods.
- Extension: unit tests per new lib handler (key mapping, fill event
  sequence, scroll modes, dialog, cdp passthrough) via the existing mocked
  `chrome.debugger` harness.
- Daemon: `/rpc` happy path, unknown method, `browserId` routing/ambiguity,
  forged-Host 403 on `/rpc` and `/shutdown` (raw `node:http` with
  `setHost: false` — `fetch` drops forged Host silently), shutdown behavior,
  singleton guard (lower port wins).
- CLI: parser unit tests; command→rpc mapping tests (pure builders in
  `cli-commands.ts`); lazy-spawn logic with injected spawn/probe fakes.
- Integration: daemon + fake extension WS + real `/rpc` calls end-to-end.

## Out of scope

- Persistent daemon across reboots (lazy spawn makes it unnecessary; a
  service can return later if anyone asks).
- Wrapping more CDP domains as curated commands — `reins cdp` covers the
  long tail; promote a method to a curated command only when usage shows
  demand.
- skills.sh leaderboard mechanics (telemetry-driven; nothing to do on our
  side beyond the repo layout).
