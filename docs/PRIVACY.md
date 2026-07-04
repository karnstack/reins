# reins — Privacy Policy

_Last updated: 2026-07-04_

reins is a browser extension that lets a **local** daemon on your own
machine (installed by you, via the `@karnstack/reins` CLI) drive your
browser. It is a developer tool; you install both halves yourself.

## What data reins handles

- **Page content and tab metadata** (titles, URLs, screenshots, console and
  network activity of tabs you interact with through your agent) are read via
  the Chrome DevTools Protocol **only when the local reins daemon asks**, and
  are sent **only** to that daemon over a WebSocket bound to `127.0.0.1` on
  your machine.
- **Settings** (auto-connect toggle, cached/pinned daemon port) are stored in
  `chrome.storage.local` on your device. Connection status is stored in
  `chrome.storage.session`.

## What reins does NOT do

- No data is sent to the developer or to any remote server. There is no
  analytics, telemetry, tracking, or advertising of any kind.
- No data is sold or shared with third parties.
- Nothing is collected in the background: the extension only acts on explicit
  commands sent through the reins CLI on your own machine.
- The extension loads no remote code.

## Security

- The daemon accepts the extension's connection only from `127.0.0.1` and
  only from allowlisted extension identities (`chrome-extension://<id>`
  origins, which browsers set themselves and web pages cannot forge).
- Chrome shows its native "is debugging this browser" banner whenever the
  extension is attached to a tab; the popup's **Disconnect** toggle severs
  the connection at any time.

## Contact

Questions or concerns: open an issue at
<https://github.com/karnstack/reins/issues> or email <mail@karngyan.com>.
