# Publishing the reins extension to the Chrome Web Store

Step-by-step for uploading and updating the reins browser extension. The npm
package release flow lives in [RELEASING.md](RELEASING.md); this doc is only
the store side.

## One-time setup

1. Open the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole).
2. Sign in and pay the **one-time $5** developer registration fee.
3. Complete the publisher account (display name, a verified contact email —
   Google requires it before publishing).

## Build the upload artifact

```bash
pnpm zip
# → packages/extension/release/reins-extension-v<version>.zip
```

The zip already contains `manifest.json` at its root, the service worker,
offscreen document, popup, and icons — upload it as-is.

## Create the item (first publish)

1. Dashboard → **Add new item** → drag in the zip → upload.
2. **Store listing** tab:
   - **Description**: paste the copy from
     [Store listing description](#store-listing-description-paste-ready) below
     (well under the 16k-character field limit).
   - **Category**: *Developer Tools*.
   - **Language**, and the graphic assets (see
     [Graphic assets](#graphic-assets) below).
3. **Privacy** tab: paste the answers from
   [Privacy tab (paste-ready)](#privacy-tab-paste-ready) below.
4. **Distribution**: Public — or Unlisted first if you want to test the store
   install privately before going public.
5. **Submit for review.**

## Privacy tab (paste-ready)

Each answer below fits its field's 1,000-character limit. Paste verbatim.

**Single purpose description**

```text
reins has one narrow purpose: let the user's own coding agent (software running on their machine) drive their own browser. A local companion daemon — installed by the user via the reins CLI (npm: @karnstack/reins) and bound to 127.0.0.1 — sends commands that this extension executes: list/open/close/focus tabs, navigate, click, type, fill forms, scroll, take screenshots, read page text, and read console messages and network requests for debugging. All communication is confined to the user's machine; the extension never contacts a remote server and never sends data anywhere except the user's own local daemon.
```

**debugger justification**

```text
Core function of the extension: executes the user's agent commands on tabs via the Chrome DevTools Protocol — clicking, typing, scrolling, taking screenshots, reading page text and element snapshots, and reading console messages and network requests. Commands originate only from the user's own daemon on 127.0.0.1. Chrome displays its native "is being debugged" banner whenever the extension is attached to a tab, and the popup's Disconnect button detaches immediately.
```

**tabs justification**

```text
Lists open tabs (title and URL) so the user's agent can pick a target tab, and opens, closes, and focuses tabs — plus resizes the tab's window — on the agent's behalf. Tab metadata is sent only to the user's own local daemon on 127.0.0.1, never to a remote server.
```

**storage justification**

```text
Stores a small amount of on-device configuration: the auto-connect preference, the cached port of the local daemon, and the last connection status shown in the popup. No browsing data or page content is stored, and nothing is synced or transmitted off the device.
```

**offscreen justification**

```text
Hosts the persistent WebSocket connection to the user's local daemon on 127.0.0.1. MV3 service workers are suspended when idle and cannot hold long-lived sockets; the offscreen document keeps the connection alive so the user's agent commands are delivered reliably.
```

**Are you using remote code?** — **No, I am not using remote code.** All code
ships inside the extension package; nothing is fetched or eval'd from the
network. (The eval-JavaScript feature runs strings supplied by the user's own
local agent in the *page* context via the DevTools Protocol — the same as the
user typing into the DevTools console — not remote code executed with extension
privileges.)

**Data usage** — check **none** of the collection boxes. The extension collects
nothing for the developer: no analytics, no telemetry, no remote servers. Page
data is only relayed to the user's own local daemon on 127.0.0.1. Tick all
three certification checkboxes (no sale/transfer to third parties; no use
unrelated to the single purpose; no creditworthiness/lending use) — all
truthfully apply, and the form requires all three.

**Privacy policy URL** — `https://reins.tech/privacy` (the site in
`packages/web`, deployed to Cloudflare). Until that deploy is live, use
`https://github.com/karnstack/reins/blob/main/docs/PRIVACY.md` instead (the
repo must be public for it to resolve).

## Graphic assets

The **Graphic assets** section of the listing form. Ready-made, branded assets
live in [`packages/extension/store-assets/`](../packages/extension/store-assets)
(regenerate with `python3 packages/extension/store-assets/generate.py`).

| Slot | Required | Size | Format | Use |
|---|---|---|---|---|
| **Store icon** | ✅ | 128×128 | PNG | `packages/extension/icons/icon-128.png` |
| **Screenshots** (≤5) | ✅ (≥1) | 1280×800 or 640×400 | JPEG / 24-bit PNG, no alpha | `store-assets/screenshot-1280x800.png` |
| **Small promo tile** | optional | 440×280 | JPEG / 24-bit PNG, no alpha | `store-assets/small-tile-440x280.png` |
| **Marquee promo tile** | optional | 1400×560 | JPEG / 24-bit PNG, no alpha | `store-assets/marquee-1400x560.png` |
| Global promo video | optional | — | YouTube URL | skip |

The generated screenshot is a **branded hero** — enough to submit. For a
stronger listing, add real captures too (up to 5): the toolbar popover in its
connected state, and an agent driving a page. Capture at exactly 1280×800 (or
640×400) with no alpha channel.

## Store listing description (paste-ready)

Copy the block below into the **Description** field. The field is **plain
text** — the store renders it verbatim, so the copy deliberately contains no
markdown. It is ~3.2k characters — well under the store's 16,000-character
limit.

```text
Take the reins of your real, logged-in browser from your coding agent.

reins lets AI coding agents — Claude Code, Cursor, Codex, GitHub Copilot, and any tool with a shell — drive the actual Chromium browser you already use, with all your sessions and logins intact. No separate automation profile, no launch flags, no signing in again. Your agent lists tabs, opens pages, clicks, types, fills forms, scrolls, screenshots, reads the page, runs JavaScript, and inspects console and network activity — right in your everyday browser.

Everything stays on your machine. The extension talks only to a small companion program running locally on 127.0.0.1. Nothing is ever sent to a remote server, and no page data leaves your computer.

HOW IT WORKS

reins has two halves you install yourself:

1. This extension — connects to a local companion daemon over a WebSocket bound to 127.0.0.1.
2. The reins CLI (@karnstack/reins, installed from npm) — runs that daemon, which your coding agent controls with simple commands.

Once both are in place, the extension discovers the daemon on its own and the toolbar popover turns green. From then on, your agent drives the browser through the CLI.

WHAT YOUR AGENT CAN DO

• Tabs — list, open, close, and focus tabs across every connected browser
• Navigate — go to a URL, or back / forward / reload
• Inspect — snapshot the page's interactive elements, read visible text, capture screenshots
• Interact — click, type, fill inputs, choose dropdown options, hover, scroll, press keys, upload files
• Debug — read recent console messages and network requests for a tab
• Advanced — evaluate JavaScript and issue raw Chrome DevTools Protocol commands

PRIVACY AND SECURITY

• Local only. Page content and tab data are read via the Chrome DevTools Protocol only when your local daemon asks, and are sent only to that daemon on 127.0.0.1.
• No tracking. No analytics, no telemetry, no advertising. Nothing is collected for the developer, sold, or shared with third parties.
• No remote code. All code ships inside the extension.
• You stay in control. Chrome shows its native "is being debugged" banner whenever the extension is attached to a tab, and the popup's Disconnect button cuts the connection instantly.
• Trusted connections only. The daemon accepts the extension solely from allowlisted chrome-extension:// origins on 127.0.0.1 — an identity web pages cannot forge.

PERMISSIONS, AND WHY

• debugger — runs your agent's commands (click, type, screenshot, read console/network) on tabs via the Chrome DevTools Protocol. Chrome shows its native debugging banner while attached.
• tabs — list, open, close, and focus tabs, and resize the tab's window.
• storage — stores the auto-connect setting, cached daemon port, and connection status on your device.
• offscreen — hosts the persistent WebSocket to your local daemon; MV3 service workers can't hold long-lived connections.

REQUIREMENTS

reins is a developer tool. The extension needs the reins CLI installed on your machine to connect to:

npm i -g @karnstack/reins

It's open source. Learn more, see the docs, or file an issue at https://github.com/karnstack/reins
```

## ⚠ After the first approval

The store assigns the extension a **permanent ID**. Put it into
`PUBLISHED_EXTENSION_IDS` in `packages/cli/src/allowlist.ts` and ship a patch
release of `@karnstack/reins`. Until then, store-installed extensions connect
only after a manual `reins allow <id>`.

## Automating later releases (Chrome Web Store API)

After the first manual publish, releases upload to the store automatically
from CI (see [RELEASING.md](RELEASING.md)). One-time OAuth setup:

1. [Google Cloud Console](https://console.cloud.google.com/) → new project →
   **enable the "Chrome Web Store API"**.
2. **OAuth consent screen** → External → add your Google account as a test user.
3. **Credentials** → Create **OAuth client ID** → type **Desktop app** → note
   the **client ID** and **client secret**.
4. Get a **refresh token** for that client (the
   [`chrome-webstore-upload` "how to generate credentials" guide](https://github.com/fregante/chrome-webstore-upload/blob/main/How%20to%20generate%20Google%20API%20keys.md)
   walks through the one-time OAuth exchange).
5. Add these repo secrets (Settings → Secrets → Actions):
   - `CWS_EXTENSION_ID` — the ID the store assigned this item
   - `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET`, `CWS_REFRESH_TOKEN`

From then on, merging a "Version Packages" PR ships to npm **and** — when the
release actually bumps the extension version — uploads + submits the new zip
to the store. CLI-only releases skip the upload (the workflow compares the
local extension version against the store's `crxVersion`), so reviewers never
see a resubmission of an identical build. To publish a store update by hand instead:
`pnpm zip`, then Dashboard → the reins item → **Package** → upload → **Submit
for review**.

## Review expectations

The `debugger` permission triggers **manual review** and an install-time
warning — inherent to what reins does. Reviewers look for exactly what the
listing states: local-only, a user-installed daemon, the native "is being
debugged" banner, and the popup's **Disconnect** kill switch. Expect the
first review to take longer than later updates.
