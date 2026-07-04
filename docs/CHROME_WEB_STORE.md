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
   - **Description**: what reins does — drive your real, logged-in browser
     from a coding agent via the reins CLI; everything local.
   - **Category**: *Developer Tools*.
   - **Language**, and a store icon (128×128 is in the zip).
   - **Screenshots**: at least one **1280×800** (or 640×400) PNG. The store
     will not publish without one. A good shot: the toolbar popover in its
     connected state next to an agent driving a page.
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

## ⚠ After the first approval

The store assigns the extension a **permanent ID**. Put it into
`PUBLISHED_EXTENSION_IDS` in `packages/cli/src/allowlist.ts` and ship a patch
release of `@karnstack/reins`. Until then, store-installed extensions connect
only after a manual `reins allow <id>`.

## Updating (later releases)

1. Bump the version (see [RELEASING.md](RELEASING.md) — changesets keeps the
   CLI and extension versions in lockstep).
2. `pnpm zip` to rebuild the artifact.
3. Dashboard → the reins item → **Package** → upload the new zip → **Submit
   for review**.

## Review expectations

The `debugger` permission triggers **manual review** and an install-time
warning — inherent to what reins does. Reviewers look for exactly what the
listing states: local-only, a user-installed daemon, the native "is being
debugged" banner, and the popup's **Disconnect** kill switch. Expect the
first review to take longer than later updates.
