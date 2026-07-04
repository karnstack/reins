# @karnstack/reins

**Drive your real, logged-in browsers from any coding agent.**

`reins` is a CLI that controls every Chromium browser on your machine that
runs the [reins extension](https://github.com/karnstack/reins) — tabs,
clicks, typing, screenshots, JS eval, raw CDP, console and network
monitoring. Real sessions, real logins: no debug profile, no launch flags,
no MCP registration, no tokens. A small local daemon (auto-spawned by the
CLI, bound to 127.0.0.1) does the plumbing.

## Setup (once)

```bash
npm i -g @karnstack/reins
npx skills add karnstack/reins   # teach your agent(s) the CLI
# install the reins extension in your browser(s) → they connect on their own
```

That's it — the daemon starts on demand with the first command.

## Commands

```
Tabs & pages   tabs · open <url> · close · focus · nav <url|back|forward|reload>
Interaction    snapshot · click · type · fill · select · press · hover ·
               scroll · upload · wait · dialog · resize
Reading        text · screenshot · console · network
Advanced       eval '<js>' · cdp <Domain.method> ['{json}'] · daemon
Management     browsers · status · allow <id> · kill · doctor · logs · help
```

The loop: `reins snapshot` lists interactive elements with refs
(`e5: button "Submit"`) → `reins click --ref e5` → verify with `reins text`
or `reins screenshot` (prints an image path). `reins help <command>` shows
usage; `--json` gives raw results.

## Multiple browsers

One daemon serves every browser at once. Tabs from `reins tabs` are tagged
with a browser id (`b1`, `b2`, …); pass `--browser <id>` when more than one
is connected — reins errors with the roster instead of guessing.

## Security

Everything binds `127.0.0.1`. All endpoints validate the `Host` header
(DNS-rebinding protection), and the extension WebSocket only accepts exact
allowlisted `chrome-extension://<id>` origins — an identity browsers stamp
themselves and pages can't forge. Nothing ever leaves your machine.

MIT © [karnstack](https://github.com/karnstack/reins)
