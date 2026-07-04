---
name: reins
description: Control the user's real, logged-in browser from the shell — list tabs, click, type, screenshot, read pages, run JS and raw CDP — via the reins CLI. Use when asked to interact with, test, or scrape a live webpage in the user's browser.
---

# reins — drive the user's real browser

reins is a CLI that controls the user's actual browsers (Chrome, Brave, Edge,
Arc, Dia, …) through a browser extension. Real sessions, real logins — no
separate automation profile. Everything runs locally on 127.0.0.1.

## Check it works (once per session)

```bash
reins status
```

- `daemon : not running` is fine — the daemon starts on demand.
- `browser: none connected` → the user needs the reins extension installed
  (Chrome Web Store, or `reins allow <id>` for an unpacked dev build).
- `command not found: reins` → `npm i -g @karnstack/reins`.

## Core loop

1. **Find the tab** — `reins tabs` lists every tab in every connected
   browser (`b1  tab 12 *  Title — url`; `*` = active tab).
2. **See what's interactive** — `reins snapshot --tab 12` prints elements
   with refs like `e5: button "Submit"`.
3. **Act on refs** — `reins click --ref e5 --tab 12`,
   `reins type --ref e3 --text "hi" --enter --tab 12`.
   CSS selectors work anywhere a ref does: `--selector "#submit"`.
4. **Verify** — `reins text --tab 12` (visible page text) or
   `reins screenshot --tab 12` (prints an image path — Read the file to view
   it). Refs go stale after navigation; re-run `snapshot`.

## Commands

```
tabs / open <url> / close / focus / nav <url|back|forward|reload>
snapshot        interactive elements + refs
click           --ref|--selector [--button right|middle] [--count 2]
type            --text "…" [--enter]      keystrokes into an element
fill            --value "…"               set an input's value directly (fast)
select          --value "…"               <select> dropdowns (value or label)
press           --key "Escape"|"Meta+A"|"Shift+Tab"   keyboard
hover           menus / tooltips
scroll          --ref|--selector | --by "0,600" | --to top|bottom
upload          --file <path> [--file …]  file inputs
wait            --state visible|hidden|present [--timeout ms]
dialog          --accept|--dismiss [--text "…"]   answer alert/confirm/prompt
resize          --width 1280 --height 800
text            visible page (or element) text
screenshot      [--full] [--out path]     prints the image file path
console         [--level error] recent console messages
network         [--url pattern] recent requests
eval            'document.title' [--await]   JS in the page
cdp             <Domain.method> ['{json}']   raw Chrome DevTools Protocol
```

Every command takes `--tab <id>` (default: the active tab) and `--json`
(raw result). `reins help <command>` shows exact usage.

## Multiple browsers

Tabs are tagged with a browser id (`b1`, `b2`, …). With more than one
browser connected, pass `--browser <id>` — commands error with the roster
otherwise, never guess. `reins browsers` shows who's connected.

## Escape hatches

- `reins eval` runs arbitrary JS in the page and prints the value.
- `reins cdp` calls any CDP method — cookies, geolocation, PDF, tracing:
  `reins cdp Network.clearBrowserCookies --tab 12`. Caveat: `Emulation.*`
  overrides reset when the command's debugger session detaches; for lasting
  viewport changes use `reins resize`.

## Gotchas

- A JS dialog (alert/confirm/prompt) blocks the page — nothing works until
  `reins dialog --accept` (or `--dismiss`).
- `type` sends real keystrokes (triggers autocomplete etc.); `fill` sets the
  value in one step and fires input/change — prefer it for forms.
- `console`/`network` only capture from their first use on a tab onward.
- Errors like `element not found` usually mean a stale ref — `snapshot` again.
- Deeper diagnostics: `reins doctor`, `reins logs`.
