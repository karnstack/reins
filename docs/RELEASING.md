# Releasing reins

Two artifacts ship together and share one version (kept in lockstep by
changesets):

1. **`@karnstack/reins`** — the npm package (CLI + daemon)
2. **reins extension** — the Chrome Web Store item (version drives the manifest
   and the `pnpm zip` filename)

`@reins/protocol` is private and bundled into the npm package; it is ignored by
changesets and never published on its own.

## Versioning with changesets

Every change that should appear in a release gets a changeset:

```bash
pnpm changeset
```

Pick the bump (`patch` / `minor` / `major`) and write a one-line summary.
`@karnstack/reins` and `@reins/extension` are a **fixed** group — selecting one
bumps both to the same version. Commit the generated `.changeset/*.md` file
alongside your change.

## Cutting a release

```bash
# 1. consume changesets → bump package.json versions + write CHANGELOGs
pnpm version-packages
#    (both packages move to the same new version)

# 2. sanity check
pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm zip

# 3. commit the version bump, tag, push
git commit -am "release: v<version>"
git tag v<version>          # must match the new package version
git push origin main --tags
```

The `release` workflow (triggered by the `v*` tag) then:

- runs lint / typecheck / test / build / zip,
- publishes `@karnstack/reins` to npm (needs the **`NPM_TOKEN`** repo secret —
  an npm automation token with publish rights for the `@karnstack` scope, with
  npm provenance enabled),
- creates a GitHub release with `reins-extension-v<version>.zip` attached.

Then upload that same zip to the Chrome Web Store — see
[CHROME_WEB_STORE.md](CHROME_WEB_STORE.md).

## First release (0.1.0)

The packages are seeded at **0.1.0**. For the very first release there is
nothing to `version` — just tag it:

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm zip
git tag v0.1.0
git push origin main --tags
```

Before the first tag, make sure the **`NPM_TOKEN`** secret exists and the repo
is public (the extension's privacy-policy URL points at `docs/PRIVACY.md` on
GitHub).

## npm notes

- `@reins/protocol` is bundled (`noExternal` in `packages/cli/tsdown.config.ts`),
  so the published package has no workspace dependencies.
- Smoke-test the tarball before the first publish:

  ```bash
  cd packages/cli && npm pack
  npx -y ./karnstack-reins-*.tgz status
  ```
