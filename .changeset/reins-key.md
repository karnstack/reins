---
"@karnstack/reins": minor
"@reins/extension": minor
---

`reins key set|status|clear typesafe` stores a TypeSafe API key in `~/.reins/credentials.json` (readable only by you), after checking it with TypeSafe. The extension popup gains a Jev section to save, replace or remove the same key. This is the setup for `reins do`. On the extension side: the popup gains the Jev key section and its `reins:call` frame carries a per-call timeout for the slow key check.
