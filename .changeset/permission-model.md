---
"@karnstack/reins": minor
"@reins/extension": minor
---

Per-site permission tiers (deny/read/full) enforced in the extension.
`reins policy` shows and tightens policy; grants are popup-only. New
bridge methods `policy_get`/`policy_tighten`; denied tabs are redacted in
`list_tabs`. Default remains full access everywhere.
