# Publishing reins

Two artifacts ship from this repo:

1. **`@karnstack/reins`** — npm package (daemon + `reins` CLI)
2. **reins extension** — Chrome Web Store item

Versions live in `packages/mcp/package.json` and
`packages/extension/package.json` (the extension manifest reads its version
from there). Keep them in lockstep.

## Release flow (both artifacts)

```bash
# 1. bump versions
#    packages/mcp/package.json       "version": "0.3.0"
#    packages/extension/package.json "version": "0.3.0"

# 2. sanity check locally
pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm zip

# 3. tag and push
git commit -am "release: v0.3.0"
git tag v0.3.0
git push origin main --tags
```

The `release` workflow then:

- publishes `@karnstack/reins` to npm (needs the **`NPM_TOKEN`** repo secret —
  an npm automation token with publish rights for the @karnstack scope),
- creates a GitHub release with `reins-extension-v<version>.zip` attached.

The zip can also be produced locally with `pnpm zip` →
`packages/extension/release/reins-extension-v<version>.zip`.

## npm notes

- `@reins/protocol` is private; it is **bundled** into the package at build
  time (`noExternal` in `packages/mcp/tsdown.config.ts`), so the published
  package has no workspace dependencies.
- Smoke-test the tarball before first-time publish:

  ```bash
  cd packages/mcp && npm pack
  npx -y ./karnstack-reins-*.tgz status
  ```

## Chrome Web Store submission

One-time setup: register as a Chrome Web Store developer
(<https://chrome.google.com/webstore/devconsole>, one-time $5 fee).

Per release: upload the zip from `pnpm zip`, then fill/refresh the listing.

### ⚠ After the FIRST store publish

The store assigns the extension a permanent ID. Put it into
`PUBLISHED_EXTENSION_IDS` in `packages/mcp/src/allowlist.ts` and ship a patch
release of `@karnstack/reins` — until then, store-installed extensions can
only connect after a manual `reins allow <id>`.

### Listing content

- **Single purpose**: "Lets a local MCP daemon (installed by the user, e.g.
  for Claude Code) drive the user's own browser: list/open tabs, navigate,
  click, type, screenshot, and read console/network activity — all local,
  user-initiated, and confined to 127.0.0.1."
- **Category**: Developer Tools.
- **Screenshots**: at least one 1280×800 (popover connected state + an agent
  driving a page is enough).
- **Privacy policy URL**:
  `https://github.com/karnstack/reins/blob/main/docs/PRIVACY.md`

### Permission justifications (copy-paste, adjust as needed)

| Permission | Justification |
|---|---|
| `debugger` | Core function: executes the user's agent commands (click, type, screenshot, read console/network) on tabs via the Chrome DevTools Protocol. Chrome shows its native debugging banner while attached. |
| `tabs` | The `list_tabs` / `open_tab` / `select_tab` tools need tab IDs, titles, and URLs. |
| `storage` | Stores the auto-connect setting, cached daemon port, and connection status on-device. |
| `offscreen` | Hosts the persistent WebSocket to the user's local MCP daemon; MV3 service workers cannot hold long-lived sockets. |

### Data-use disclosures (Privacy tab)

- Collects **no** user data for the developer: no analytics, no remote
  servers; page data goes only to the user's own machine (`127.0.0.1`).
- Remote code: **No** — all code is packaged in the extension.

### Review expectations

The `debugger` permission triggers manual review and an install-time warning;
that is inherent to what reins does. The listing text above (local-only,
user-installed daemon, kill switch, native debugging banner) is what
reviewers look for. Expect a slower first review.
