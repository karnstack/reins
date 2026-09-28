# @reins/extension

## 0.6.0

### Minor Changes

- f2b0801: `reins do '<goal>'` hands a small browser task to TypeSafe's Jev model: it reads the page, picks each click, field and dropdown with one Jev call per step, and types only the values the agent passed with `--fill`. It stops and prints the exact next command for risky clicks (buy, send, delete, ...), missing values, dialogs, leaving the site, or no progress. `--continue` resumes the run, and `--confirm '<label>'` pre-approves a click. Exit codes: 0 done, 2 stopped for input, 1 error. On the extension side: the `jev_observe` / `jev_act` handlers (site tier `full`), per-tab JS dialog tracking, and a pre-action re-check of each chosen element. Jev can also submit a search field with Enter (`SUBMIT_SEARCH`, search-like fields only), a click that opens a new tab moves the run to that tab, three stale acts in a row stop the run as `stuck`, and the summary line reports the Jev input tokens used. A click on a link that opens a new tab (`target="_blank"`), from `reins click` or `reins do`, no longer lets Chrome raise its window over the app you are working in: the extension opens the tab itself, next to the current one and active; `reins click` reports the new tab's id (`openedTabId` in `--json`).
- c7b6513: `reins key set|status|clear typesafe` stores a TypeSafe API key in `~/.reins/credentials.json` (readable only by you), after checking it with TypeSafe. The extension popup gains a Jev section to save, replace or remove the same key. This is the setup for `reins do`. On the extension side: the popup gains the Jev key section and its `reins:call` frame carries a per-call timeout for the slow key check.

## 0.5.0

### Minor Changes

- f7669b6: `reins extension --reload` re-stages the bundled extension and has a connected unpacked build (a dev checkout or the `reins extension` sideload) reload itself, then waits for it to reconnect. That replaces the manual ⟳ Reload click in `chrome://extensions`. A Chrome Web Store install refuses, because it updates itself.

  The extension now announces its version to the daemon, so `--reload` reports the version that came back up. The extension also connects on every service-worker start if nothing is connected: Chrome can drop the install event during a reload, and re-enabling the extension fires none, which left it silently disconnected.

- 9c7fb71: `reins groups` lists tab groups (title, color, collapsed, tab count) across connected browsers, and `reins tabs` marks each grouped tab with `g<id>`. A browser without the tab-group API answers with an error that names it (`<browser> (b2) doesn't support tab groups …`), and `reins groups` lists such browsers as skipped instead of dropping them silently. Dia supports tab groups. The extension asks for the `tabGroups` permission, which shows no install prompt.
- 1033778: `reins group` puts tabs in a new or existing tab group and edits a group's title, color, and collapsed state. `reins ungroup` takes tabs out of their group or dissolves a whole group, and never closes tabs. reins groups nothing on its own; the agent decides. Group operations count as reading: read-only sites can be grouped, denied sites cannot.

### Patch Changes

- 3ddece9: `click`, `hover`, and `press` no longer silently no-op.

  - **Plain `reins click` never pressed.** The CLI omits `button`/`clickCount` unless flagged, and nothing applied the protocol defaults, so CDP received `button: "none"`, `clickCount: 0`: the pointer moved but no press or click fired. Clicks now default to a single left click.
  - **Clicks land where the element is.** The target is scrolled instantly (smooth scroll no longer leaves stale coordinates) and must hold still across two frames with no pending animation. It's hit-tested so an overlay is named (`cannot click #buy: covered by div#cookie-banner`), and must be enabled (`element is disabled` instead of an `ok` that did nothing). A press seen landing on something else is reported. An element that never stops animating is clicked anyway if its center still hits it.
  - **Password managers no longer lock reins out.** Chrome refuses to debug a tab holding another extension's frame, and 1Password/Bitwarden/… inject one as their autofill menu when a field gets focus. While reins drives a tab it hides those menus, including on pages it navigates to or opens. It stands down 30s after the last command.
  - **Background tabs.** Chrome holds CDP input for hidden tabs and replays it whenever the tab is next shown; click/hover/press now bring the tab to the front first.
  - **`press Enter` and `type --enter`** now submit forms and activate buttons, and `press <letter>` types into the focused input.
  - **`dialog`** no longer enables the Page domain first, which hung while a dialog was open.

## 0.4.0

### Minor Changes

- 65ce7f3: `reins audit`, a per-action audit trail. The extension stamps each response with the resolved host, permission tier, and tab; the daemon writes one redacted JSONL line per action (policy denials included) to `~/.reins/logs/audit-YYYY-MM-DD.jsonl`, pruned after 30 days. Value-bearing params (typed text, fill values, eval code, CDP payloads) are redacted before anything reaches disk.

## 0.3.0

### Minor Changes

- d8108a6: Per-site permission tiers (deny/read/full) enforced in the extension.
  `reins policy` shows and tightens policy; grants are popup-only. New
  bridge methods `policy_get`/`policy_tighten`; denied tabs are redacted in
  `list_tabs`. Default remains full access everywhere.

## 0.2.0

### Minor Changes

- f6b30a4: New `reins extension` command: install the extension without the Chrome Web
  Store. The npm package now bundles the extension build with a key-pinned,
  pre-allowlisted id. `reins extension` stages it at `~/.reins/extension` for
  Chrome's Load unpacked, no `reins allow` step. See docs/SIDELOAD.md.
