# reins — Privacy Policy

_Last updated: 2026-09-27_

reins is a browser extension that lets a **local** daemon on your own
machine (installed by you, via the `@karnstack/reins` CLI) drive your
browser. It is a developer tool; you install both halves yourself.

## What data reins handles

- **Page content and tab metadata** (titles, URLs, tab group names and colors, screenshots, console and
  network activity of tabs you interact with through your agent) are read via
  the Chrome DevTools Protocol **only when the local reins daemon asks**, and
  are sent **only** to that daemon over a WebSocket bound to `127.0.0.1` on
  your machine.
- **Settings** (auto-connect toggle, cached/pinned daemon port) are stored in
  `chrome.storage.local` on your device. Connection status is stored in
  `chrome.storage.session`.

## What reins does NOT do

- No data is sent to the developer. The only remote service reins can talk to
  is TypeSafe, and only when you've opted in (see below). There is no
  analytics, telemetry, tracking, or advertising of any kind.
- No data is sold or shared with third parties.
- Nothing is collected in the background: the extension only acts on explicit
  commands sent through the reins CLI on your own machine.
- The extension loads no remote code.

## Optional: reins do with Jev

`reins do` is off until you save a TypeSafe API key (`reins key set typesafe`,
or the Jev section of the extension popup). The key is stored in
`~/.reins/credentials.json` on your machine (readable only by you). Only the
local reins daemon reads that file; the popup passes the key to the daemon
once when you save it.

While a `reins do` run is working, the **daemon** (not the extension) sends
this to `api.typesafe.ai`, under your own TypeSafe account:

- the goal you gave, and your `--fill` names and values
- the tab's URL and title
- visible text in the viewport (up to about 6,000 characters)
- labels, roles and current values of the page's interactive elements
- the run's last 10 actions

Never sent: password, file and hidden inputs. Nothing at all is sent unless you
saved a key and ran `reins do`. The extension itself still makes no remote
requests.

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
