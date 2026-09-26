---
"@karnstack/reins": patch
"@reins/extension": patch
---

`click`, `hover`, and `press` no longer silently no-op.

- **Plain `reins click` never pressed.** The CLI omits `button`/`clickCount` unless flagged, and nothing applied the protocol defaults, so CDP received `button: "none"`, `clickCount: 0`: the pointer moved but no press or click fired. Clicks now default to a single left click.
- **Clicks land where the element is.** The target is scrolled instantly (smooth scroll no longer leaves stale coordinates) and must hold still across two frames with no pending animation. It's hit-tested so an overlay is named (`cannot click #buy: covered by div#cookie-banner`), and must be enabled (`element is disabled` instead of an `ok` that did nothing). Afterwards reins confirms the press reached it.
- **Password managers no longer lock reins out.** Chrome refuses to debug a tab holding another extension's frame, and 1Password/Bitwarden/… inject one as their autofill menu when a field gets focus. While reins drives a tab it hides those menus, including on pages it navigates to or opens. It stands down 30s after the last command.
- **Background tabs.** Chrome holds CDP input for hidden tabs and replays it whenever the tab is next shown; click/hover/press now bring the tab to the front first.
- **`press Enter`** now submits forms and activates buttons, and `press <letter>` types into the focused input.
