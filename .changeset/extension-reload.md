---
"@karnstack/reins": minor
"@reins/extension": minor
---

`reins extension --reload` re-stages the bundled extension and has a connected unpacked build (a dev checkout or the `reins extension` sideload) reload itself, then waits for it to reconnect. That replaces the manual ⟳ Reload click in `chrome://extensions`. A Chrome Web Store install refuses, because it updates itself.

The extension now announces its version to the daemon, so `--reload` reports the version that came back up. The extension also connects on every service-worker start if nothing is connected: Chrome can drop the install event during a reload, and re-enabling the extension fires none, which left it silently disconnected.
