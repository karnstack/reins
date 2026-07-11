# @karnstack/reins

## 0.3.0

### Minor Changes

- d8108a6: Per-site permission tiers (deny/read/full) enforced in the extension.
  `reins policy` shows and tightens policy; grants are popup-only. New
  bridge methods `policy_get`/`policy_tighten`; denied tabs are redacted in
  `list_tabs`. Default remains full access everywhere.

## 0.2.1

### Patch Changes

- 6885954: Trust the published Chrome Web Store extension (`hnjcfgochepemjndccfblpmfmlblkofo`) out of the box — store installs connect without `reins allow`.

## 0.2.0

### Minor Changes

- f6b30a4: New `reins extension` command: install the extension without the Chrome Web
  Store. The npm package now bundles the extension build with a key-pinned,
  pre-allowlisted id — `reins extension` stages it at `~/.reins/extension` for
  Chrome's Load unpacked, no `reins allow` step. See docs/SIDELOAD.md.

### Patch Changes

- 9e4242a: Docs: split release/Chrome Web Store guides, add the store listing description
  and ready-made branded graphic assets (icon, screenshot, promo tiles), and
  clean up stale MCP-era wording. No runtime changes.
