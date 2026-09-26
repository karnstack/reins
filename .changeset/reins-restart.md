---
"@karnstack/reins": minor
---

`reins restart` stops the background daemon and starts a fresh one, waiting for previously connected browsers to come back (and exiting 1 if they don't). After `npm i -g @karnstack/reins@latest`, the next tool command (e.g. `reins tabs`) notices a daemon older than the CLI and restarts it on the new version, instead of leaving the old code running; `reins status` and `reins doctor` point out the mismatch. `reins kill` now waits until the daemon has actually exited.
