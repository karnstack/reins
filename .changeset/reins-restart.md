---
"@karnstack/reins": minor
---

`reins restart` stops the background daemon and starts a fresh one, waiting for connected browsers to come back. After `npm i -g @karnstack/reins@latest`, the first command now notices a daemon older than the CLI and restarts it on the new version, instead of leaving the old code running. `reins kill` now waits until the daemon has actually exited.
