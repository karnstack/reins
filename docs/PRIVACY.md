# reins — Privacy Policy

_Last updated: 2026-07-04_

reins is a browser extension that lets a **local** MCP client (such as Claude
Code or Codex) drive your own browser. It is a developer tool; you install and
pair it yourself.

## What data reins handles

- **Page content and tab metadata** (titles, URLs, screenshots, console and
  network activity of tabs you interact with through your agent) are read via
  the Chrome DevTools Protocol **only when your paired, local MCP server asks
  for them**, and are sent **only** to that server over a WebSocket bound to
  `127.0.0.1` on your machine.
- **Pairing data** (the local server URL and a pairing token) is stored in
  `chrome.storage.local` on your device.
- **Connection status** is stored in `chrome.storage.session` on your device.

## What reins does NOT do

- No data is sent to the developer or to any remote server. There is no
  analytics, telemetry, tracking, or advertising of any kind.
- No data is sold or shared with third parties.
- Nothing is collected in the background: the extension only acts on explicit
  commands from the MCP client you paired.
- The extension loads no remote code.

## Security

- The WebSocket connection is restricted to `127.0.0.1` (your own machine)
  and authenticated with a pairing token created on your machine.
- Chrome shows its native "is debugging this browser" banner whenever the
  extension is attached to a tab; the popup's **Disconnect** button severs the
  connection and clears the pairing at any time.

## Contact

Questions or concerns: open an issue at
<https://github.com/karnstack/reins/issues> or email <mail@karngyan.com>.
