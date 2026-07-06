# Sideload install path (no Chrome Web Store)

**Date:** 2026-07-06
**Status:** approved

## Problem

The reins extension is pending Chrome Web Store review. Review can stall or
fail (the `debugger` permission guarantees manual review). Users need a
supported way to install the extension that does not depend on the store —
both as a launch fallback and as a permanent option for people who prefer it.

Outside the store, the only viable path for regular users is Chrome's
**load unpacked** (CRX sideloading is enterprise-policy-only on Windows/Mac).
The from-source flow in [RUNNING.md](../../RUNNING.md) already works but
requires a repo checkout, a build, and a per-machine `reins allow` step.

## Design

CLI-managed sideload: the npm package carries the built extension; one command
stages it for load-unpacked; a pinned key makes its ID stable and
pre-allowlisted, so there is no `reins allow` step.

### Identity: pinned key

- A one-time RSA keypair was generated offline. Only the **public key** enters
  the repo (`packages/cli/sideload-key.json`); it is not a secret. The private
  key is never needed for load-unpacked installs and is archived off-repo.
- The public key is injected as the `"key"` field of the bundled build's
  `manifest.json`. Chrome derives the extension ID from it, so the sideloaded
  extension has the **same ID on every machine**: it ships in the CLI's
  built-in allowlist next to `PUBLISHED_EXTENSION_IDS`.
- The store zip (`pnpm zip`, release.yml) is untouched — no `key` field (the
  store rejects uploads that contain one).

Threat-model note: any *unpacked* extension can copy a public key and claim
its ID — true for the store build's key too (it is visible in installed
manifests). Users who enable developer mode and load a malicious unpacked
extension are already compromised; store-installed extensions still cannot
forge IDs. No change to the existing security posture.

### Packaging

- `packages/cli/scripts/bundle-extension.mjs` copies
  `packages/extension/dist/` → `packages/cli/extension/` and injects the
  `key` into that copy's `manifest.json`. It runs after `tsdown` in the CLI's
  `build` and `prepack` scripts.
- `packages/cli/package.json` gains `files: ["dist", "extension"]` and a
  `@reins/extension` devDependency so turbo builds the extension first.
- `packages/cli/extension/` is generated output — gitignored, added to the
  turbo `build` outputs.

### CLI command: `reins extension`

- Extracts the bundled dir to `~/.reins/extension/` (delete + copy — the path
  is **fixed** so the load-unpacked registration never breaks; hashed chunk
  files from old versions do not accumulate).
- Prints numbered steps: open `chrome://extensions` → enable Developer mode →
  Load unpacked → select `~/.reins/extension`. On re-run (CLI upgrade) the
  same output notes clicking ⟳ Reload on the extension card.
- In a source checkout without the bundle, fails with a message pointing at
  RUNNING.md.

### Docs

- New `docs/SIDELOAD.md`: user-facing walkthrough (npm install → `reins
  extension` → load unpacked → verify with `reins status`), the update story
  (re-run + Reload after CLI upgrades), and the dev-mode caveats.
- README Install section: one line offering the no-store path.
- `reins help`: `extension` listed under Management.

### Out of scope / future

- Extension-version drift detection (`BrowserInfo` carries no extension
  version today; a handshake field + `doctor` warning is a follow-up).
- Auto-opening `chrome://extensions` (not reachable from a CLI).
- Website docs page for sideloading.

## Testing

- Unit: extension ID derived from the committed public key
  (sha256(SPKI DER) → first 16 bytes → a–p alphabet) equals the committed ID;
  `loadAllowedOrigins` includes the sideload origin with no allow-file.
- Unit: `extractExtension` copies a tree, removes stale files from a previous
  extract, and throws when the source bundle is missing.
- Existing suites unchanged; `pnpm lint && pnpm typecheck && pnpm test &&
  pnpm build` green.
