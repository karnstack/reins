# Permission model (site policy + read-only tiers) — design

Date: 2026-07-11. Status: approved. Roadmap: Phase 1 (v0.3) — "Trust: a
permission model". This spec unifies the roadmap's "site policy" and
"read-only mode" bullets into one policy model. Audit log, SECURITY.md, and
the full SKILL.md hardening pass are separate Phase 1 slices, out of scope
here.

## Goal

Contain reins' blast radius per site. Today the extension is all-or-nothing:
connected means every tab, every origin, cookies included. After this change,
each host resolves to a tier — `deny`, `read`, or `full` — enforced inside
the extension, the one place a local process can't fake. Grants (loosening)
happen only through the extension popup, a user gesture the agent cannot
perform from the shell.

Shipped default preserves today's zero-config behavior: `full` everywhere.
The policy model is opt-in hardening.

## Decisions (settled during brainstorming)

| Question | Decision |
| --- | --- |
| Scope | Site policy + read-only as one unified model |
| Tiers | 3: `deny` < `read` < `full` |
| Rule granularity | Host or `*.wildcard` (Chrome match-pattern style) |
| Shipped default | `full` everywhere (today's behavior) |
| Grant path | Popup-only; CLI can view + tighten, never loosen |
| Architecture | Extension-owned: policy in `chrome.storage.local`, enforced in dispatch |

## Policy model

```ts
// @reins/protocol
type Tier = "deny" | "read" | "full"; // ordered: deny < read < full

interface PolicyRule {
  pattern: string; // "github.com" | "*.google.com"
  tier: Tier;
}

interface Policy {
  defaultTier: Tier; // shipped default: "full"
  rules: PolicyRule[];
}
```

- **Storage.** `chrome.storage.local`, key `reinsPolicy`, per browser
  profile. Multi-browser setups get independent policies by construction —
  intended (work profile locked down, scratch profile open).
- **Matching precedence.** Exact host beats wildcard; longest wildcard
  suffix beats shorter; otherwise `defaultTier`. `*.foo.com` matches
  subdomains **and** the apex `foo.com` (Chrome match-pattern convention).
- **Scheme handling.** Rules match http(s) hosts. Tabs with non-http(s) or
  unparseable URLs (chrome://, about:blank, extension pages) are governed by
  `defaultTier` only.
- **Pattern validation.** Bare host or a single leading `*.`; `*` anywhere
  else is rejected. Input normalized: lowercased, scheme and port stripped.

## Method classification

Lives in `@reins/protocol` as `Record<Method, Tier>` keyed by the method
union type, so an unclassified new method is a compile error, not a silent
policy hole.

| Required tier | Methods |
| --- | --- |
| `read` | `list_tabs`, `read_snapshot`, `read_text`, `screenshot`, `read_console`, `read_network`, `wait_for` |
| `full` | `navigate`, `open_tab`, `close_tab`, `select_tab`, `click`, `type`, `press_key`, `hover`, `scroll`, `fill`, `select_option`, `upload`, `resize`, `handle_dialog`, `eval_js`, `cdp` |
| always allowed | `policy_get`, `policy_tighten` (tightening is safe by construction) |

## Enforcement (extension)

The gate sits in `packages/extension/src/lib/dispatch.ts`, before the method
switch:

1. Resolve the target tab (reuse `resolveTabId` from `cdp.ts`; tab
   resolution is centralized here so the gate and the handler agree on the
   target).
2. Extract the tab URL's host; compute the effective tier.
3. Compare against the method's required tier. On failure, throw a
   `FrameError`-shaped error:
   `{ code: "policy_denied", message: "blocked by policy: <host> is read-only — grant full access from the reins extension popup" }`.
   The message always names the host, its current tier, and the remediation.

Special cases:

- **`navigate` / `open_tab`** additionally check the **destination** host —
  both current and destination hosts need `full`. `back`/`forward`/`reload`
  have unknowable destinations; current host at `full` suffices.
- **`deny` tier** refuses every tab-scoped method. `list_tabs` **redacts**
  denied tabs rather than omitting them: `tabId` kept, `url` and `title`
  blanked, `blocked: true` added to the Tab shape. No information leak, but
  the agent is not gaslit when the active tab is denied.
- **`policy_tighten`** applies only when the new tier is strictly lower than
  the current tier for that exact pattern. Raising a tier or deleting a rule
  is rejected with the popup hint. The comparison runs in the extension —
  the daemon cannot fake it.
- **Iframes.** Cross-origin iframes are governed by the top-level page host.
  Frame-granular policy is out of scope for v0.3 (the future threat-model
  doc will note this).

Caching: the service worker keeps the policy in memory, refreshed via
`chrome.storage.onChanged`. The cache is initialized before dispatch accepts
work; if initialization fails, dispatch refuses all requests (fail closed).

## Protocol additions

- `policy_get` → returns the current `Policy`.
- `policy_tighten` `{ pattern, tier }` → applies iff strictly tightening;
  otherwise a `policy_denied`-class error with the popup hint.
- `Tab` gains optional `blocked: boolean` (redacted entries).
- `FrameError` code `"policy_denied"` (the `code` field already exists).

## Surfaces

### CLI — `reins policy`

- `reins policy` — show `defaultTier`, rules, and the effective tier for
  each open tab's host (via `policy_get` + `list_tabs`).
- `reins policy deny <pattern>` / `reins policy readonly <pattern>` —
  tighten via `policy_tighten`.
- `reins policy allow <pattern>` — exists but always errors:
  `grants require the extension popup — click the reins icon in <browser>`.
  Deliberate: a discoverable path that teaches agent and user where grants
  live.
- `--browser <id>` routes like every other command; ambiguity with multiple
  browsers handled the same way existing commands handle it.

### Popup — "Site permissions" section

Below the connection status:

- **Current-tab row.** Host of the active tab + 3-way segmented control
  (full / read / deny). This is the one-click grant path.
- **Rules list.** Each rule: pattern, tier, delete button. Add-rule input
  for wildcard patterns.
- **Default stance.** 3-way control for `defaultTier`.
- The popup writes `chrome.storage.local` directly — it *is* the user
  gesture; no tighten-only restriction applies.

## Error handling

- `policy_denied` errors flow through the existing error path: CLI prints
  the message and exits nonzero.
- SKILL.md gets a short gotcha (not the full hardening pass): commands can
  fail with `policy_denied` — relay the popup instructions to the user; do
  not retry.

## Testing

- **protocol**: tier-map completeness (compile-time via `Record<Method,
  Tier>`); matcher precedence table test (exact > longest wildcard >
  default; apex matching; scheme/port stripping; pattern validation).
- **extension**: policy unit tests (matching, tighten-only, redaction);
  dispatch gate tests — `read` host allows `read_snapshot`, blocks `click`;
  `deny` blocks everything and redacts `list_tabs`; `navigate`/`open_tab`
  destination check; fail-closed on cache init failure.
- **cli**: `reins policy` arg parsing; `allow` error path; output
  formatting.
- **integration.test.ts**: the stub extension gains policy state; end-to-end
  — tighten to `readonly`, `click` fails with `policy_denied`, `snapshot`
  succeeds.
- Operational note: rebuild `@reins/protocol` before running cli/extension
  tests.

## Out of scope (v0.3, this slice)

- Audit log (`reins audit`) — next Phase 1 slice.
- SECURITY.md threat-model doc — next Phase 1 slice.
- Full SKILL.md hardening pass (prompt-injection section).
- Frame-granular policy; per-category deny lists ("deny-sensitive-
  categories" from the roadmap — revisit once real usage shows demand).
- Firefox / non-Chromium.
