# @reins/extension

## 0.4.0

### Minor Changes

- 65ce7f3: `reins audit` — a per-action audit trail. The extension stamps each response with the resolved host, permission tier, and tab; the daemon writes one redacted JSONL line per action (policy denials included) to `~/.reins/logs/audit-YYYY-MM-DD.jsonl`, pruned after 30 days. Value-bearing params (typed text, fill values, eval code, CDP payloads) are redacted before anything reaches disk.

## 0.3.0

### Minor Changes

- d8108a6: Per-site permission tiers (deny/read/full) enforced in the extension.
  `reins policy` shows and tightens policy; grants are popup-only. New
  bridge methods `policy_get`/`policy_tighten`; denied tabs are redacted in
  `list_tabs`. Default remains full access everywhere.

## 0.2.0

### Minor Changes

- f6b30a4: New `reins extension` command: install the extension without the Chrome Web
  Store. The npm package now bundles the extension build with a key-pinned,
  pre-allowlisted id — `reins extension` stages it at `~/.reins/extension` for
  Chrome's Load unpacked, no `reins allow` step. See docs/SIDELOAD.md.
