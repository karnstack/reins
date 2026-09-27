# reins do — design

Date: 2026-09-27
Status: approved in chat (sections 1–4 + review fixes), pending spec review

## Problem

An agent driving reins pays one full LLM turn per browser action:
`reins snapshot` → think → `reins click` → think → … A 15-step form takes
minutes. [browser-use/jev-ultrafast](https://github.com/browser-use/jev-ultrafast)
(MIT) shows the alternative: TypeSafe's **Jev**, a "System One" model that
answers typed multiple-choice questions in ~180 ms, picks the next operation
and its target in one request. Their Google Flights run takes 7.1 s end to end.

## Principle

The calling agent stays in charge. It delegates one bounded, verifiable
sub-task to `reins do`, supplies every text value itself (`--fill`), and
verifies the result. Jev only *chooses* among elements that were actually
observed. Model output never becomes a selector, coordinate, or code. There is
no text-generating model in the loop, so the only key is the user's TypeSafe key.

## Scope

In:

- `~/.reins/credentials.json` holding the TypeSafe key, shared by all browsers
- `reins key set|status|clear typesafe`
- Popup "Jev" section: pitch, save/replace/remove key, status
- Extension→daemon `call` frame (key methods only)
- Extension methods `jev_observe` and `jev_act`
- Daemon Jev loop, `reins do`, `--continue`, `--confirm`
- Skill, web docs, PRIVACY/SECURITY/CWS disclosure, changeset
- Offline tests, extension browser tests, a manual paid benchmark

Out (YAGNI for v1):

- A text LLM / OpenRouter key (agent supplies text)
- A `low_confidence` stop (Jev target probabilities over 30+ elements are
  routinely < 0.5; measure before adding)
- Per-site Jev opt-out or a built-in denylist (the user owns the key and the
  decision; we disclose clearly instead)
- Masking filled values in later snapshots
- `TYPESAFE_API_KEY` env var
- Streaming step progress to the CLI
- iframes, shadow DOM, uploads, pop-up tabs, canvas (inherited jev limits)
- Background-tab execution without activation (tracked by #37's
  focus-emulation spike)

## Key storage and setup

**File.** `~/.reins/credentials.json`, mode `0600`, written atomically
(temp file in same dir → `rename`). Shape: `{ "typesafe": "<key>" }`. Only
the daemon reads it. Read fresh at the start of every `do` run, held in memory
only for that run.

**CLI.**

```
reins key set typesafe      # hidden prompt; or: echo "$K" | reins key set typesafe
reins key status            # typesafe: set (••••a1b2) | not set
reins key clear typesafe
```

`set` validates the key with one minimal `systemone` call (a one-question
noul on a tiny state) before writing; a 401 prints `TypeSafe rejected this
key` and writes nothing. These are daemon RPCs (`key_set`, `key_status`,
`key_clear`) so the CLI and popup share one code path.

**Popup "Jev" section** (under the connection block):

- *No key:* one line of pitch: "Add a Jev key and `reins do` runs whole
  browser tasks in seconds, not minutes." Link to
  `https://console.typesafe.ai/keys` and to the docs' "what is sent" section.
  Masked input + **Save**.
- *Key set:* `Jev ready · ••••a1b2` + **Replace** / **Remove**.
- *Daemon not connected:* input disabled, "Start reins to save a key".
- Save shows the daemon's validation error inline.

**`call` frame (extension → daemon).** New in `@reins/protocol`:

```ts
CallFrame = { type: "call", id: string, method: string, params: unknown }
```

The daemon answers with the existing `ResponseFrame` (same `id`). The
extension's `BridgeClient` gains a small pending-call map mirroring the
daemon's. The daemon accepts `call` only from an already-welcomed browser and
only for `key_set`, `key_status`, `key_clear`. Anything else →
`{ ok: false, error: { code: "METHOD_NOT_ALLOWED" } }`. Popup → background →
offscreen → WS, reusing the existing `chrome.runtime` message path.

**Invariants.** The key is never returned by any method (status returns only
`set` + last 4), never sent to a page or the extension beyond the single
save hop, and never written to the audit log (`key_set` is logged with its
params dropped).

## CLI

```
reins do "<goal>" [--fill name=value]... [--confirm "<label>"]... [--continue]
                  [--tab <id>] [--browser <id>] [--max-steps 30] [--timeout 60] [--json]
```

- Acts on the active tab by default, like every page command. Never navigates
  on its own; the agent runs `reins open` first.
- `--fill` repeatable; `name` is `[a-z0-9_-]+`, `value` is any string.
- `--confirm` repeatable; pre-approves a click on an element whose normalized
  label equals the given string, once per flag.
- `--continue` resumes this tab's last run (see Runs). `<goal>` is optional
  with `--continue`; new `--fill`/`--confirm` merge into the run.
- `--max-steps` counts executed actions (default 30). Jev calls are capped at
  `2 × max-steps` to bound stale re-observations.
- `--timeout` is wall-clock seconds for the whole run (default 60). The CLI's
  HTTP wait for `do` is `timeout + 40 s`: the loop cuts itself off at
  `--timeout`, but the `jev_act` in flight at that moment can still take one
  full bridge call (30 s) to come back (today the wait is a fixed 30 s,
  `cli.ts:24`; `rpc()` gains a `timeoutMs` option).

### Result

Exit code: `0` done, `2` handoff, `1` error.

| status | when | printed `next:` |
|---|---|---|
| `done` | Jev chose DONE on a fresh page | `reins snapshot` (verify; DONE is not proof) |
| `risky_action` | next click's label is risky and not confirmed | `reins do --continue --confirm "<label>"` |
| `needs_text` | TYPE_TEXT chosen, fill head chose NONE or no fills | `reins do --continue --fill <name>="…"` (field label shown) |
| `left_site` | host moved outside the start host (see Stop rules) | re-run from the new page, or take over |
| `dialog` | a JS alert/confirm/prompt is open | `reins dialog …`, then `--continue` |
| `interrupted` | the run's tab became hidden (user switched tabs) | `reins do --continue` |
| `blocked` | Jev chose BLOCKED | take over manually |
| `stuck` | 3 consecutive non-WAIT actions with no page change, or a `--continue` run that changed nothing | take over manually (`reins snapshot` → click/type) |
| `budget` | max-steps, Jev-call cap, or timeout reached | `reins do --continue` |
| error | no key, TypeSafe HTTP error, invalid Jev answer, tab gone, browser disconnected, policy below `full` | message as-is |

Every stop line carries progress: `stopped at step 12/30 · page changed 9× · 4.8s`.

Human output:

```
done in 7.2s · 17 steps · 17 jev calls
  1 click  "Where from?"
  2 type   "Where from?" ← from
  3 click  "Zürich, Switzerland"  (option)
  …
now: https://www.google.com/travel/flights/search?… — "Zurich to London | Google Flights"
next: reins snapshot   # verify before trusting DONE
```

`--json`:

```ts
{
  status, reason?, next?,                       // next = the exact command above
  pending?: { op: "click" | "type", label: string },
  steps: { op, label, fill?, confidence, ms, pageChanged }[],
  url, title, elapsedMs, jevCalls, step, maxSteps
}
```

Errors that happen mid-run (disconnect, tab gone) still return `steps` so far.

## Loop (daemon, `packages/cli/src/jev/`)

One file per job:

| file | job |
|---|---|
| `credentials.ts` | read/write/clear `credentials.json` (0600, atomic) |
| `client.ts` | thin wrapper over the official SDK `@typesafe-ai/sdk` (MIT, zero deps, Node ≥ 20; pinned exact): `TypeSafeClient.systemOne` with the run's `AbortSignal`, the SDK's default retries (408/429/5xx, 2 retries, honours Retry-After), 8 s per attempt, logging off. On top of the SDK's typing, validate every choice answer (choice ∈ offered, probabilities keyed exactly by the options, each in [0,1], sum within 0.02 of 1). Invalid → throw, nothing executes. `AuthenticationError`/`PermissionDeniedError` → "TypeSafe rejected the API key". |
| `space.ts` | snapshot → indexed element list + questions (port of jev `model.py` `action_space`/`choose`) |
| `prompts.ts` | port of jev `questions.py` + fill rules |
| `loop.ts` | the run state machine |
| `runs.ts` | per-tab run memory, mutex, loop breaker |

`rpc.ts` handles `do` in the daemon (it is not forwarded as one bridge call);
the loop issues `jev_observe` / `jev_act` through the existing
`bridge.requestFull()` with the normal 30 s per-call timeout.

### One step

1. **Check abort.** The loop receives an `AbortSignal` wired to the HTTP
   request's `close` event (`daemon.ts` `/rpc` handler) and to `--timeout`.
   Checked before every Jev call and every `jev_act`. Ctrl-C or a dead agent
   stops the run before the next action.
2. **Observe** (`jev_observe`). If `dialog` is set → stop `dialog`. If the page
   is hidden → stop `interrupted` (except on the first step, where `jev_act`'s
   `ensureVisible` brings the tab forward as `click` does today).
3. **Ask Jev** (one request, speculative fan-out):
   - `operation`: CLICK / TYPE_TEXT / SELECT / SUBMIT_SEARCH (only those with
     candidates), SCROLL_UP / SCROLL_DOWN / WAIT, DONE, BLOCKED
   - SUBMIT_SEARCH presses Enter in a search field that already holds the
     query, for pages with no Search button. Only fields the snapshot marks
     `submit` (single-line text controls that look like search: `type=search`,
     `role=searchbox`, inside a search form/landmark, named `q`/`query`/
     `search`, or labeled search/query/find) with a non-empty value are
     offered — Enter in a chat or comment box means *send*, and its label
     ("Message") carries no risky word for the gate to catch.
   - `click_target`, `type_text_target`, `select_target`: one per offered
     operation, each listing only compatible elements
   - **fill heads, one per text field:** when fills exist, `fill_for_<i>` for
     each TYPE_TEXT candidate `i` (the first 8 in document order). Options are
     `name: value` for every fill plus `NONE`. Instructions: "If the next
     action types into field [i], which value belongs in it?" Each head is
     conditioned on its own field, so from/to with two city values are
     answered per field, still in one round trip. If Jev picks a TYPE_TEXT
     target outside the first 8, one extra request asks that field's head
     alone.
4. **Gate** (stop rules below). Only the chosen operation's target is used.
5. **Act** (`jev_act`). A `stale` result means the target changed or is
   covered: re-observe without counting a step (counts toward the Jev-call
   cap).
6. **Record** the step before observing the result; `pageChanged` is filled
   in by the next observation.

A `stale` act (target gone, covered, moving) uses no step but is remembered:
the history Jev sees carries `could not <op> "<label>": <reason>`, and three
stale acts in a row stop the run as `stuck`. A click that opens a new tab
(`target=_blank`) comes back with `openedTabId`; the extension brings that
tab forward (before any policy check on its host: activation is not a page
action, and a denied host still fails at the next observe) and waits, bounded,
for its document to load, and the run follows it — every later observe/act, the stored run
(`browserId:<newTab>`), the result's `tabId` and every `next:` line use the
new tab. The site rule applies to the new tab's host as to any observation.

State sent to Jev per request: goal; url, title; visible viewport text
(capped at 6,000 chars); elements (index, role, label, value,
checked/selected/expanded, options for native selects); last 10 actions
(`op`, label, fill name, pageChanged); fill names and values. Never sent:
password, file, or hidden inputs (the snapshot skips them) and the key.

### Stop rules

- **Risky click.** Case-insensitive **whole-word** match of the target's
  label against: `buy, pay, purchase, order, checkout, send, post, publish,
  share, invite, delete, remove, transfer, unsubscribe, approve, authorize,
  accept`. Also risky: a click target with **no accessible name** (label is
  empty or equals its role). Not risky: labels matching a `--confirm` value,
  or whose normalized full label appears verbatim in the goal (goal "book the
  9:40 flight", label "Book" → allowed; goal "delete the spam", label "Delete
  account" → stops). Generic `submit / confirm / continue / next / search` are
  not on the list; stopping every search form would cause the back-and-forth
  this command exists to remove. **Consent banners:** the snapshot marks a
  click target `consent: true` when its label says accept/agree and an
  ancestor (below `body`) is a consent banner — its id/class/aria-label/
  data-testid mentions cookie/consent/privacy/GDPR/tracking, or it is a
  dialog/alertdialog/region/banner/complementary/`<dialog>`/`<aside>`/
  aria-modal container whose first 600 chars of text do. The gate waives the
  word `accept` for such a target and nothing else: "Delete all cookies" in a
  banner still stops, and "Accept invitation" outside one still stops. The skill states that this is a heuristic
  with holes (other languages, odd labels), not a guarantee.
- **left_site.** Before each act, the current host must equal the run's start
  host or be a subdomain of it, or vice versa (`a === b || a.endsWith("." + b)
  || b.endsWith("." + a)`). No public-suffix list. Login redirects to another
  host stop the run, which is fine.
- **stuck.** 3 consecutive non-WAIT actions whose next observation has the
  same fingerprint. The fingerprint is `url + text + elements` and **excludes
  scroll position**, because `actionPoint` scrolls targets into view
  (`actionability.ts:92`).
- **budget.** `step == maxSteps`, `jevCalls == 2 × maxSteps`, or timeout.

### Runs (`runs.ts`)

- Keyed by `browserId:tabId` (tab ids repeat across browsers).
- One run per tab at a time: a second `do` on a busy tab fails fast with
  `a reins do run is already active on this tab`.
- Kept in daemon memory after the run stops: goal, start host, fills,
  confirms, history, step count, last fingerprint. Evicted after 15 minutes or
  when a new non-continue run starts on the tab.
- `--continue` with nothing stored →
  `no run to continue on this tab (runs are forgotten after 15 minutes or a daemon restart) — run reins do "<goal>" again`.
- **Loop breaker.** A `--continue` run that ends without any page change stops
  `stuck`, and marks the run. The next `--continue` on that tab is refused
  until the page's fingerprint differs from the stored one.
- `--continue` keeps the run's history and step count (numbering carries on:
  `12/30` → `12/42`). Each invocation gets its own budget of `--max-steps` more
  actions, its own Jev-call cap, and its own `--timeout`, so a run that stopped
  on `budget` can actually continue.

### Daemon restarts and version skew (#39)

`reins restart`, `reins kill`, and `ensureDaemon`'s automatic restart of a
daemon older than the CLI all go through `POST /shutdown`.

- **Shutdown during a run.** `/shutdown` aborts every active run through the
  same `AbortSignal` (no new action starts), waits up to 1 s for an in-flight
  `jev_act` to return, and answers each waiting `do` with status
  `interrupted`, reason `daemon restarting`, the steps so far, and
  `next: reins do --continue`. That `--continue` then reports
  `no run to continue on this tab (runs are forgotten after 15 minutes or a daemon restart) — run reins do "<goal>" again`,
  because run memory is in-process. The key file is on disk, so restarts never
  lose it.
- **Older daemon, newer CLI.** Handled already: `ensureDaemon` restarts it
  before `do` is sent.
- **Older extension, newer daemon.** `jev_observe` comes back unknown. `do`
  fails with `the reins extension is too old for reins do — update it (reins
  extension --reload for unpacked builds)`.
- **Newer extension, older daemon.** The old daemon ignores `call` frames. The
  popup times out a `call` after 5 s and shows `update the reins CLI and run
  reins restart`.
- The popup re-fetches `key_status` whenever it opens or the connection comes
  back, so a restart never leaves a stale "Jev ready".

## Extension

Two new bridge methods, both `full` in `METHOD_TIERS`, gated per call by
`gate()` (so a mid-run navigation to a stricter host is refused there).
`observe` needs `full` because page content leaves the machine; `do` acts
anyway.

Every debugger attach (any command, not only `jev_*`; the monitor's session
too, since drive commands reuse it) enables `Emulation.setFocusEmulationEnabled`
once, best-effort. A tab `reins open` created sits behind Chrome's omnibox, so
in the page `document.hasFocus()` is false, and sites that key behaviour off
focus (GitHub's search combobox, a password manager's "menu is available"
text) diverge from a human session; with the emulation the page reports focus
like a foreground tab.

**`jev_observe { tabId? } → JevObservation`**

- One `Runtime.evaluate` of `lib/jev-snapshot.ts`: a port of jev's
  `snapshot.js` (common HTML + ARIA controls, `checkVisibility`,
  viewport-only, skips password/file/hidden, native select options,
  recursive label names). Node identity lives in an in-page cache under
  `Symbol.for("reins.jev")`, the same pattern as the existing pointer probe.
  It is separate from `reins snapshot`'s `data-reins-ref` (issue #37 may unify).
- Returns `{ url, title, text, visible, elements, fingerprint, pageKey,
  guards, dialog? }`. Nothing tracks dialogs today. Add a per-tab dialog
  flag fed by `chrome.debugger.onEvent` (`Page.javascriptDialogOpening` sets
  it, `…Closed` clears it). Page events are already on for sessions armed by
  the autofill guard, which `jev_act` uses (`withDebugger(…, { guard: true })`).
  `jev_observe` checks the flag **before** evaluating, because an open dialog
  blocks `Runtime.evaluate` (`cdp.ts:163`). A dialog opened by an action
  surfaces on the next observe.
- **Settling.** An action that navigates leaves the tab `loading` while the
  old document is still the one an evaluate sees (the commit comes later),
  and the new document has no body or is still parsing for a while after
  that. Observe waits, bounded by 4 s, until the tab is no longer loading or
  the document reports `interactive` (only a new document can, under a
  loading tab), polling every 100 ms; past the bound it reads whatever
  document has a body, and throws `the page did not finish loading` only
  when none does. A page script exception is surfaced as `page script
  failed: …`, never mistaken for loading.

**`jev_act { tabId?, node, op, value?, delta? } → { ok: true } | { stale: true, reason }`**

- Resolve `node` from the cache. Missing, disconnected, or guard mismatch →
  `stale`.
- **click**: reuse the #30 click path (`ensureVisible` → `actionablePoint` →
  pointer events → landed check), refactored so it can take a resolved
  element instead of re-querying a CSS selector each attempt. `jev_act` passes
  an actionability timeout of **500 ms** (today's `ACTION_TIMEOUT_MS` is 5 s)
  and maps "covered" or "still moving" to `stale`. The loop re-observes, and
  the covering modal is then in the element list. A press the probe saw
  landing on another element ("the page changed under the pointer") is
  `stale` too — nothing intended happened; `reins click` keeps reporting
  that as an error, since nothing re-observes behind it.
- **type**: click to focus (same path), select-all
  (`Input.dispatchKeyEvent` with the `selectAll` command, Meta on macOS,
  Ctrl elsewhere), then `Input.insertText`.
- **select**: native `<select>` only. Set `value`, dispatch `input` and
  `change`. If the option vanished, return an error (not `stale`), so the loop
  never retries an uncertain mutation.
- **scroll**: `mouseWheel` at viewport centre, `deltaY ±560` (the
  snapshot's scroll pseudo-actions carry that delta).
- **wait**: 250 ms.
- **Settle**, after any input: at most 2 animation frames or 50 ms; for a
  typed combobox, up to 200 ms or until a visible `[role=option]` appears
  (port of jev `observe`'s after-input wait).

## Audit

- One `do` entry per run: goal, status, steps, jevCalls, elapsedMs; `fills`
  values redacted (add `fills` to `redactParams` with a test row, keep names).
- One `jev_act` entry per action through the normal bridge audit hook: host,
  op, label; `value` already redacted by `VALUE_KEYS`.
- `key_set`: logged without params.

## Docs

- `docs/PRIVACY.md`: new section "Optional: reins do with Jev". It says that
  when you add a TypeSafe key and run `reins do`, the **daemon** sends the
  state listed above to `api.typesafe.ai` under your TypeSafe account, that
  nothing is sent without a key, and that the extension itself still makes no
  remote requests. Update "What reins does NOT do" to scope the "no remote
  server" line accordingly.
- `docs/SECURITY.md`: threat notes: page text can try to steer Jev (it can
  only choose observed elements; risky-label stop is a heuristic); the key
  file's location and permissions.
- `docs/CHROME_WEB_STORE.md`: data-disclosure update (popup accepts an API
  key and passes it only to the local daemon).
- Web docs: `reins do` and `reins key` command reference, a "what is sent"
  section, and a changelog entry.
- `skills/reins/SKILL.md`: when to use `do` (multi-step forms, search and
  filter flows, navigation), and to pass every value from the goal as `--fill`
  up front. Pre-confirm the final action when the user asked for it. Follow
  the printed `next:` line. Always verify after `done`. Switch to manual
  commands on `stuck`.
- Changeset (minor).

## Testing

Offline (CI, no paid calls):

- `space.ts`: fixture snapshots → questions; each operation offers only
  compatible elements; fill heads only for TYPE_TEXT candidates, capped at 8.
- `client.ts`: invalid answers throw (choice not offered, bad probability
  keys or sum, missing head); retry/backoff on 429/503/529; 401 surfaces as a
  key error.
- `loop.ts` with a fake Jev + fake bridge: every status fires; abort before
  act on request close; stale → re-observe without a step; `--continue` keeps
  history and budget; `--confirm` allows exactly one click; goal-verbatim
  pre-approval; whole-word risky matching ("Remove filter" stops, "Postcode"
  does not); scroll-only changes do not count as progress; loop breaker.
- `runs.ts`: `browserId:tabId` keying, busy-tab refusal, eviction, restart
  message.
- `credentials.ts`: 0600, atomic replace, clear.
- Protocol: `CallFrame` schema; the daemon rejects non-key `call` methods;
  `redactParams` row for `fills`.

Extension browser tests (style of `pointer.browser.test.ts`), local fixtures:

- A fixed-position modal is listed; disabled, hidden, and covered elements
  are excluded; password never listed; select options listed.
- A replaced node between observe and act → `stale`; covered target →
  `stale` within ~500 ms.
- Typing replaces existing text; native select fires `change`; combobox
  settle waits for options.

Popup: the three key states render; save error shown inline.

Manual paid benchmark (`packages/cli/scripts/bench-do.ts`, never in CI):

- Tasks: Google Flights one-way search (two fills), open a named Wikipedia
  article, a GitHub search with a filter, and one site with a cookie banner.
- Two arms: `reins do` vs `claude -p` driving reins step by step with the same
  goal. At least 5 runs per task per arm.
- An independent checker verifies each outcome (URL, fields, results). Speed
  is compared only on verified runs.
- Ship bar: verified success of `reins do` ≥ manual on every task, and median
  wall time on verified runs ≥ 3× faster.

## Delivery (stacked PRs)

1. **Key plumbing.** `CallFrame`, `credentials.ts`, `key_*` RPCs, `reins key`,
   popup Jev section, audit redaction, PRIVACY/SECURITY/CWS docs.
2. **Extension methods.** `jev-snapshot.ts`, `jev_observe`, `jev_act`,
   click-path refactor (element input + timeout option), dialog state,
   browser tests.
3. **The loop.** `client/space/prompts/loop/runs`, `reins do`, abort wiring,
   CLI `rpc()` timeout, skill + web docs, changeset, benchmark script and
   first results.
