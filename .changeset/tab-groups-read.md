---
"@karnstack/reins": minor
"@reins/extension": minor
---

`reins groups` lists tab groups (title, color, collapsed, tab count) across connected browsers, and `reins tabs` marks each grouped tab with `g<id>`. A browser without the tab-group API answers with an error that names it (`<browser> (b2) doesn't support tab groups …`), and `reins groups` lists such browsers as skipped instead of dropping them silently. Dia supports tab groups. The extension asks for the `tabGroups` permission, which shows no install prompt.
