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
3. **Privacy** tab:
   - **Single purpose**: "Lets a local daemon (installed by the user via the
     reins CLI, e.g. for coding agents) drive the user's own browser —
     list/open tabs, navigate, click, type, screenshot, read console/network —
     all local and confined to 127.0.0.1."
   - **Permission justifications**:

     | Permission | Justification |
     |---|---|
     | `debugger` | Executes the user's agent commands (click, type, screenshot, read console/network) on tabs via the Chrome DevTools Protocol. Chrome shows its native debugging banner while attached. |
     | `tabs` | List / open / close / focus tabs, and resize the tab's window. |
     | `storage` | Stores the auto-connect setting, cached daemon port, and connection status on-device. |
     | `offscreen` | Hosts the persistent WebSocket to the user's local daemon; MV3 service workers cannot hold long-lived sockets. |

   - **Data usage**: collects **no** user data; no analytics, no remote
     servers; **not** sold or shared; loads **no** remote code.
   - **Privacy policy URL**:
     `https://github.com/karnstack/reins/blob/main/docs/PRIVACY.md`
     (the repo must be public for this to resolve).
4. **Distribution**: Public — or Unlisted first if you want to test the store
   install privately before going public.
5. **Submit for review.**

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

Copy everything between the rules into the **Description** field. It is ~2.6k
characters — well under the store's 16,000-character limit.

---

**Take the reins of your real, logged-in browser from your coding agent.**

reins lets AI coding agents — Claude Code, Cursor, Codex, GitHub Copilot, and any tool with a shell — drive the actual Chromium browser you already use, with all your sessions and logins intact. No separate automation profile, no launch flags, no signing in again. Your agent lists tabs, opens pages, clicks, types, fills forms, scrolls, screenshots, reads the page, runs JavaScript, and inspects console and network activity — right in your everyday browser.

Everything stays on your machine. The extension talks only to a small companion program running locally on 127.0.0.1. Nothing is ever sent to a remote server, and no page data leaves your computer.

## How it works

reins has two halves you install yourself:

1. This extension — connects to a local companion daemon over a WebSocket bound to 127.0.0.1.
2. The reins CLI (@karnstack/reins, installed from npm) — runs that daemon, which your coding agent controls with simple commands.

Once both are in place, the extension discovers the daemon on its own and the toolbar popover turns green. From then on, your agent drives the browser through the CLI.

## What your agent can do

- Tabs — list, open, close, and focus tabs across every connected browser
- Navigate — go to a URL, or back / forward / reload
- Inspect — snapshot the page's interactive elements, read visible text, capture screenshots
- Interact — click, type, fill inputs, choose dropdown options, hover, scroll, press keys, upload files
- Debug — read recent console messages and network requests for a tab
- Advanced — evaluate JavaScript and issue raw Chrome DevTools Protocol commands

## Privacy & security

- Local only. Page content and tab data are read via the Chrome DevTools Protocol only when your local daemon asks, and are sent only to that daemon on 127.0.0.1.
- No tracking. No analytics, no telemetry, no advertising. Nothing is collected for the developer, sold, or shared with third parties.
- No remote code. All code ships inside the extension.
- You stay in control. Chrome shows its native "is being debugged" banner whenever the extension is attached to a tab, and the popup's Disconnect button cuts the connection instantly.
- Trusted connections only. The daemon accepts the extension solely from allowlisted chrome-extension:// origins on 127.0.0.1 — an identity web pages cannot forge.

## Permissions, and why

- debugger — runs your agent's commands (click, type, screenshot, read console/network) on tabs via the Chrome DevTools Protocol. Chrome shows its native debugging banner while attached.
- tabs — list, open, close, and focus tabs, and resize the tab's window.
- storage — stores the auto-connect setting, cached daemon port, and connection status on your device.
- offscreen — hosts the persistent WebSocket to your local daemon; MV3 service workers can't hold long-lived connections.

## Requirements

reins is a developer tool. The extension needs the reins CLI installed on your machine to connect to:

    npm i -g @karnstack/reins

It's open source. Learn more, see the docs, or file an issue at https://github.com/karnstack/reins

---

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

From then on, merging a "Version Packages" PR ships to npm **and** uploads +
submits the new zip to the store. To publish a store update by hand instead:
`pnpm zip`, then Dashboard → the reins item → **Package** → upload → **Submit
for review**.

## Review expectations

The `debugger` permission triggers **manual review** and an install-time
warning — inherent to what reins does. Reviewers look for exactly what the
listing states: local-only, a user-installed daemon, the native "is being
debugged" banner, and the popup's **Disconnect** kill switch. Expect the
first review to take longer than later updates.
