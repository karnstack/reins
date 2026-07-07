# Releasing reins

Releases are **fully automated by changesets** — no manual `git tag`, no manual
`npm publish`. You describe changes; merging a bot-generated PR ships them.

Two artifacts, versioned as a **linked** changeset group:

1. **`@karnstack/reins`** — the npm package (CLI + daemon)
2. **reins extension** — the Chrome Web Store item (version drives the manifest
   and the `pnpm zip` filename)

Linked (not fixed) means each package bumps only when a changeset names it,
but whenever they bump together they land on the same version. The extension
carries the `debugger` permission, so **every store upload goes through manual
review** — CLI-only releases deliberately leave the extension version alone,
and the release workflow skips the store upload when the store already has the
current extension version.

`@reins/protocol` is private and bundled into the npm package; changesets
ignores it and it is never published on its own.

## The loop

1. **Describe each change** with a changeset and commit it alongside the code:

   ```bash
   pnpm changeset
   ```

   Pick the bump (`patch` / `minor` / `major`) and a one-line summary, and
   select the package(s) the change actually ships in:

   - **CLI-only change** (daemon, commands, docs in the npm package) →
     `@karnstack/reins` only. The extension stays at its current version and
     nothing is re-submitted to the store.
   - **Extension or protocol change** → select **both** `@karnstack/reins`
     and `@reins/extension`. A protocol change without an extension bump would
     leave the store build speaking an old protocol — CI's `protocol-guard`
     job fails the PR if `packages/protocol` changes with no
     `@reins/extension` changeset.

2. **Push to `main`.** The `release` workflow opens (or updates) a
   **"Version Packages"** PR that applies the pending changesets: bumps
   `package.json` versions and writes `CHANGELOG.md`.

3. **Merge the Version Packages PR.** That merge triggers the workflow's
   publish path:
   - publishes `@karnstack/reins` to npm (with provenance),
   - creates the git tag + GitHub release automatically,
   - if the Chrome Web Store secrets are set **and the extension version is
     newer than what the store has** (checked against the store API), builds
     the zip and uploads + submits it. CLI-only releases skip this step, so
     the store isn't re-reviewed for identical builds.

That's it — no tagging by hand.

## Required secrets (repo → Settings → Secrets → Actions)

| Secret | For | Needed by |
|---|---|---|
| `NPM_TOKEN` | npm automation token, publish rights for `@karnstack` | first release |
| `CWS_EXTENSION_ID` | the store-assigned extension ID | store auto-upload |
| `CWS_CLIENT_ID` / `CWS_CLIENT_SECRET` / `CWS_REFRESH_TOKEN` | Chrome Web Store API OAuth | store auto-upload |

Until the four `CWS_*` secrets exist, the store step is skipped and everything
else still runs. See [CHROME_WEB_STORE.md](CHROME_WEB_STORE.md) for how to get
the OAuth credentials — and note the **first** store upload is manual (that is
what assigns `CWS_EXTENSION_ID`).

## First release (0.1.0)

The packages are seeded at **0.1.0** with no changesets. On the first push to
`main` with this workflow in place, there is nothing to version, so the publish
path runs immediately and `changeset publish` pushes `0.1.0` to npm (it only
publishes versions not already on the registry). Steps for the first ship:

1. Make the repo public and add `NPM_TOKEN`.
2. Land this workflow on `main` → `@karnstack/reins@0.1.0` publishes; the tag +
   GitHub release appear automatically.
3. Manually upload `packages/extension/release/reins-extension-v0.1.0.zip` to
   the Chrome Web Store (see [CHROME_WEB_STORE.md](CHROME_WEB_STORE.md)); the
   store assigns the extension ID.
4. Put that ID in `PUBLISHED_EXTENSION_IDS` (`packages/cli/src/allowlist.ts`),
   add the four `CWS_*` secrets, and `pnpm changeset` a patch — from then on,
   every release ships to npm **and** the store automatically.

## npm notes

- `@reins/protocol` is bundled (`noExternal` in `packages/cli/tsdown.config.ts`),
  so the published package has no workspace dependencies.
- npm auth in CI is handled by the changesets action: given the `NPM_TOKEN`
  env var, it writes a user `~/.npmrc` before publishing. (A token line in the
  committed `.npmrc` would be ignored — pnpm won't expand env vars in
  project-file credentials.)
- Smoke-test the tarball once before the first publish:

  ```bash
  cd packages/cli && npm pack
  npx -y ./karnstack-reins-*.tgz status
  ```
