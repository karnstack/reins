---
"@karnstack/reins": minor
"@reins/extension": minor
---

`reins extension --reload` re-stages the bundled extension and has a connected unpacked build (a dev checkout or the `reins extension` sideload) reload itself, then waits for it to reconnect. That replaces the manual ⟳ Reload click in `chrome://extensions`. A Chrome Web Store install refuses, because it updates itself.
