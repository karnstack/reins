---
"@karnstack/reins": minor
---

`reins do '<goal>'` hands a small browser task to TypeSafe's Jev model: it reads the page, picks each click, field and dropdown in about 0.2 s, and types only the values the agent passed with `--fill`. It stops and prints the exact next command for risky clicks (buy, send, delete, ...), missing values, dialogs, leaving the site, or no progress. `--continue` resumes the run, and `--confirm '<label>'` pre-approves a click. Exit codes: 0 done, 2 stopped for input, 1 error. The extension gains `jev_observe`/`jev_act` (site tier `full`).
