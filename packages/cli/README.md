# @karnstack/reins

**Drive your real, logged-in browsers from your coding agent.**

`reins` is a local MCP daemon + CLI: MCP clients (Claude Code, Codex,
Cursor, …) connect to it over streamable HTTP on localhost, and it drives
every Chromium browser on your machine that runs the
[reins extension](https://github.com/karnstack/reins) — tabs, clicks, typing,
screenshots, JS eval, console and network monitoring. No debug profile, no
launch flags, no pairing tokens.

## Setup (once)

```bash
npm i -g @karnstack/reins
reins up                 # daemon + autostart on login (macOS/Linux)
reins install claude     # register with Claude Code
# install the reins extension in your browser(s) → they connect on their own
```

Check it: `reins status` (daemon + connected browsers), `reins tabs`
(everything the daemon can reach).

## Commands

```
up                      install + start the daemon (autostarts on login)
down                    stop the daemon and remove it from autostart
restart                 restart the daemon (e.g. after an upgrade)
serve [--stdio]         run the server in the foreground (stdio for HTTP-less clients)
install [claude|codex]  register the MCP endpoint with an agent
allow <extension-id>    allow an unpacked/dev extension to connect
browsers                list browsers connected to the daemon
tabs [browserId]        list tabs the daemon can reach
status / doctor / logs  health, diagnostics, ~/.reins/logs
```

## Multiple clients, multiple browsers

One daemon serves any number of MCP clients and browsers at once. Tabs from
`list_tabs` are tagged with a `browserId`; the agent passes it to target a
specific browser when more than one is connected.

## Security

Everything binds `127.0.0.1`. All endpoints validate the `Host` header
(DNS-rebinding protection), and the extension WebSocket only accepts exact
allowlisted `chrome-extension://<id>` origins — an identity browsers stamp
themselves and pages can't forge. Nothing ever leaves your machine.

MIT © [karnstack](https://github.com/karnstack/reins)
