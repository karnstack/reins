---
"@karnstack/reins": minor
"@reins/extension": minor
---

`reins audit` — a per-action audit trail. The extension stamps each response with the resolved host, permission tier, and tab; the daemon writes one redacted JSONL line per action (policy denials included) to `~/.reins/logs/audit-YYYY-MM-DD.jsonl`, pruned after 30 days. Value-bearing params (typed text, fill values, eval code, CDP payloads) are redacted before anything reaches disk.
