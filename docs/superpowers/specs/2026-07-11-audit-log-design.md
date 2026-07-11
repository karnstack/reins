# Audit log (`reins audit`) — design

Date: 2026-07-11. Status: approved. Roadmap: Phase 1 (v0.3) — "Trust: a
permission model", audit-log slice. SECURITY.md and the SKILL.md hardening
pass are the remaining Phase 1 slices, out of scope here.

## Goal

A first-class, structured per-action trail: every browser command reins
executes — and every one the policy blocks — leaves one line the user can
review with `reins audit`. The trail answers "what did the agent touch in my
browser?" for trust review and carries enough detail (redacted params,
outcome, duration) to debug agent runs.

## Decisions (settled during brainstorming)

| Question | Decision |
| --- | --- |
| Audience | Trust review and debugging, equally: full JSONL on disk, `reins audit` renders the trust view |
| Sensitive params | Redact value-bearing fields before write; plaintext secrets never touch disk |
| Retention | Daily files, daemon prunes >30 days on startup |
| Origin source | Extension stamps `host` + `tier` on responses (approach B); daemon composes the record |
| Writer | Daemon only — single writer, viewer works without a live browser |

## Record format

One JSON line per `/rpc` call, appended to
`~/.reins/logs/audit-YYYY-MM-DD.jsonl` (same directory as daemon logs — the
roadmap's "make the action trail first-class where `~/.reins/logs` already
lives"):

```json
{"ts":"2026-07-11T10:15:02.113Z","method":"click","browserId":"b1","browser":"Chromium","tabId":412,"host":"app.example.com","tier":"full","params":{"selector":"#submit"},"ok":true,"ms":184}
{"ts":"2026-07-11T10:15:09.442Z","method":"fill","browserId":"b1","browser":"Chromium","tabId":412,"host":"bank.com","tier":"read","params":{"selector":"#amount","value":"[redacted 7 chars]"},"ok":false,"denied":true,"error":"policy_denied: blocked by policy: bank.com is read-only — grant full access from the reins extension popup","ms":12}
```

Fields:

- `ts` — ISO 8601, daemon clock, time the request was received.
- `method` — bridge method name (`click`, `read_text`, …).
- `browserId` / `browser` — routing id + browser name from the bridge
  roster; absent when the request failed before reaching a browser.
- `tabId` — the tab the action actually hit: from response `meta` (the
  extension gate resolves the active tab when the caller omits `--tab`),
  falling back to params.
- `host` / `tier` — stamped by the extension via response `meta` (see
  below); absent on daemon-side failures or with an older extension.
- `params` — redacted copy (see Redaction).
- `ok` — mirror of the response frame.
- `denied` — `true` only for policy denials (error code `policy_denied`).
- `error` — `code: message` string when `ok` is false.
- `ms` — wall-clock duration from send to settle.

`list_tabs` (a daemon-side aggregate across browsers) audits as one line
with no `host`. Daemon-side failures — timeout, no browser connected,
disconnect mid-flight — audit with `ok: false` and the error; the trail must
show attempts, not just completions.

## Redaction

Redaction happens in the daemon **before** the write; plaintext never
reaches disk. A fixed field-name list, not heuristics:

- `text`, `value`, `expression`, `promptText` → `"[redacted <n> chars]"`.
- `upload` file paths (`files`) → basename only.
- `cdp` nested `params` → `"[redacted]"` (arbitrary CDP payloads can carry
  anything, e.g. `Input.insertText`); the `Domain.method` name stays.
- Everything else — selectors, URLs, tabIds, key names (`Enter`), scroll
  deltas — passes through verbatim.

The list lives in one exported table in the CLI package with a table-driven
test, so adding a future value-bearing param means one row + one test case.

## Data flow

1. **Protocol.** `ResponseFrame` gains an optional
   `meta: { host?: string, tier?: Tier, tabId?: number }`. Optional means
   old extensions remain compatible — their records simply lack the fields.
2. **Extension.** `gate()` in `dispatch.ts` already resolves the target
   tab (including the active-tab default), its host, and the effective
   tier. Dispatch returns them alongside the result, and the background
   stamps `meta` on the response frame for both the success path and the
   policy-denial path — denials must carry the host so the trail shows
   what was blocked, not just what ran.
3. **Denial classification.** Policy denials already carry the structured
   error code `policy_denied` (the extension's `PolicyDenied` class; the
   code survives to the ResponseFrame). The daemon auditor classifies
   `denied: true` off that code — no string matching, no new code needed.
4. **Daemon auditor.** The `/rpc` handler wraps the bridge call: capture
   start time, method, redacted params, resolve browser name from the
   roster; on settle (success or error) append the record. The auditor is
   injected into `startDaemon` like `log` is, so tests can capture records
   in memory.

## `reins audit` viewer

Reads the JSONL files directly — no daemon required.

- **Default:** today's records as a table:
  `HH:MM:SS  method  browser  host  tab  outcome  ms`. Policy denials render
  `DENIED`; other failures `error`.
- `--last <n>` — last N records, newest last, crossing day-file boundaries
  (the repo's flag parser handles `--flag` forms only, so no short `-n`).
- `--denied` — denials only.
- `--json` — raw JSONL lines (composable with `--last`/`--denied`).
- Missing host/tier (old extension, daemon-side failure) renders `—`.
- Corrupt or partially-written lines are skipped; the viewer prints a
  one-line skip count to stderr.
- `reins help` gains an `audit` line under Management.

## Retention

On daemon startup, delete `audit-*.jsonl` whose filename date is older than
30 days. Filename-based, not mtime — deterministic and testable. Daemon
`daemon-*.log` files are untouched (candidate for the same policy later,
separate change).

## Error handling

- Audit writes are best-effort, matching `createLogger`: a full disk or bad
  permissions must never fail the user's browsing command. First write
  failure logs a warning to the daemon log/stderr. The trade-off (trail can
  have gaps under disk pressure) gets documented in SECURITY.md (next Phase
  1 slice).
- The auditor never throws into the RPC path; a serialization bug in the
  auditor must not break `/rpc`.

## Testing

- **protocol:** `ResponseFrame` round-trips `meta`; absent `meta` still
  parses (back-compat).
- **extension:** dispatch stamps `meta.host`/`meta.tier`/`meta.tabId` on
  success and on policy denial (tabId as resolved by the gate, including
  the active-tab default); denial error code is `policy_denied`.
- **cli:** table-driven redaction tests; auditor unit tests (denial
  classification, duration, daemon-side failure records, browser-name
  resolution); viewer tests (parse, `--last` across files, `--denied`,
  corrupt lines); prune-on-startup test; end-to-end record via the stand-in WS
  extension in `integration.test.ts`.
- Build note: rebuild `@reins/protocol` before running cli/extension tests
  (workspace consumes `dist/`).

## Out of scope

- Popup/audit UI in the extension — the popup stays a status light and
  permissions manager.
- SKILL.md changes — the audit trail is for the user, not the agent.
- Web docs get a short section (permissions page sibling) in the same PR;
  the full threat-model treatment lands with SECURITY.md.
