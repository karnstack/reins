# Installing the extension without the Chrome Web Store

The npm package carries a full copy of the reins extension. If you can't (or
don't want to) install from the
[Chrome Web Store](https://chromewebstore.google.com/detail/reins/hnjcfgochepemjndccfblpmfmlblkofo),
`reins extension` stages it for Chrome's **Load unpacked** — no repo checkout,
no build, no `reins allow`.

```bash
npm i -g @karnstack/reins
reins extension
```

That prints the exact steps; in full:

1. `reins extension` — copies the bundled extension to `~/.reins/extension/`.
2. Open `chrome://extensions` (or `dia://extensions`, `brave://extensions`, …).
3. Enable **Developer mode** (top right).
4. **Load unpacked** → select `~/.reins/extension`.
5. `reins status` — the extension finds the daemon and connects on its own.

No `reins allow` step: the sideload build's manifest pins a public key
(`packages/cli/sideload-key.json`), so its extension ID is the same on every
machine and ships in the CLI's built-in allowlist.

## Updating

Sideloaded extensions don't auto-update. After upgrading the CLI:

```bash
reins extension --reload   # re-stage the matching version, then reload it
```

`--reload` has the connected extension re-read its files and waits for it to
reconnect — the same as clicking **⟳ Reload** on the reins card in
`chrome://extensions`, which also works. The target path never changes, so
Chrome keeps the registration. (`--reload` only works for unpacked builds; a
Chrome Web Store install updates itself and refuses.)

## Caveats

- Chrome shows its usual developer-mode reminders for unpacked extensions on
  some platforms. That's inherent to sideloading; the store build has no such
  nag.
- The sideloaded extension and a store-installed reins have different IDs and
  can coexist — but run one at a time (disable the other in
  `chrome://extensions`) so two connections don't both drive your tabs.
- Working from a source checkout instead? That flow (per-machine dev ID +
  `reins allow`) is [RUNNING.md](RUNNING.md).
