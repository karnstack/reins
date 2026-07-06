---
"@karnstack/reins": minor
"@reins/extension": minor
---

New `reins extension` command: install the extension without the Chrome Web
Store. The npm package now bundles the extension build with a key-pinned,
pre-allowlisted id — `reins extension` stages it at `~/.reins/extension` for
Chrome's Load unpacked, no `reins allow` step. See docs/SIDELOAD.md.
