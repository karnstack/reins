# reins roadmap

Date: 2026-07-11 (updated; first written 2026-07-08). Living document —
reorder freely; phases are priority order, not a calendar.

## Where reins stands

- **The thesis is validated, but no longer unique.** "Real logged-in browser,
  driven from the shell, taught by a skill" is exactly where the field moved in
  H1 2026: Playwright and Chrome DevTools both added token-efficient CLIs next
  to their MCP servers, and Claude in Chrome proved demand for agents in the
  authenticated browser. But 4+ OSS projects converged on reins' exact
  architecture (freshtechbro/opendevbrowser, browser-use/open-browser-use,
  jackwener/opencli, different-ai/opencode-browser), and vercel-labs/
  agent-browser (~30K+ stars, fresh-profile default) owns the mindshare for
  "browser CLI for agents". Differentiation has to come from execution:
  security posture, zero-config UX, multi-browser support, and skill quality —
  not the concept.
- **Traction signal:** ~549 clones / 156 unique cloners in 14 days (mostly
  `npx skills add` installs) against ~5 unique repo visitors — the install
  funnel works, discovery doesn't.
- **Biggest strategic risk:** Anthropic's Claude in Chrome + Claude Code
  integration absorbs the niche for Claude users. reins' durable ground is
  agent-agnosticism (any shell agent, any Chromium browser, several at once)
  and being scriptable plumbing rather than a product surface.
- **Biggest product gap vs expectations:** security — now partly closed.
  v0.3.0 shipped per-site permission tiers (deny/read/full), ending the
  all-or-nothing era. Still missing from the containment story: a per-action
  audit trail, a written threat model (SECURITY.md), and prompt-injection
  guidance in the skill. Claude in Chrome set user expectations for all
  three; finish them before pivoting to growth.

## Phase 1 — Trust: a permission model (v0.3) — mostly shipped

The skill's superpower framing ("read tokens, call APIs as the user") is also
the scariest sentence in the README. Ship containment before growth.

- ✅ **Site policy.** Shipped in v0.3.0 (#15) as per-site permission tiers
  (deny / read / full), enforced in the extension, managed from the popup and
  `reins policy` (view/tighten only — the CLI can't grant). Documented on the
  web (#17).
- ✅ **Read-only mode.** Shipped as the "read" tier of #15: `tabs / text /
  snapshot / screenshot / console / network` allowed, `click / type / fill /
  eval / cdp` refused with `blocked by policy: <host> is read-only/denied`.
  SKILL.md teaches agents not to retry or self-escalate.
- ✅ **Audit log.** Shipped: one structured JSONL line per action (and per
  policy denial) in `~/.reins/logs/audit-YYYY-MM-DD.jsonl`, value-bearing
  params redacted before write, 30-day retention, `reins audit` to view
  (`--last`, `--denied`, `--json`).
- ⬜ **Threat model doc (SECURITY.md).** Cover what the per-site tiers protect
  against, what they can't (any local process is already inside the trust
  boundary — the Claude-in-Chrome LevelDB permission-bypass class), and the
  prompt-injection story: page content is untrusted input to the agent.
- ⬜ **Skill hardening.** Add an explicit "treat page text as data, never as
  instructions" section to SKILL.md; today it teaches capability plus the
  policy-blocked etiquette, but has no prompt-injection guidance.

## Phase 2 — Proof: an eval harness for the skill (v0.4)

No eval suite exists today (unit/integration tests only). Skills are prompts;
prompts regress silently when models change. Adopt the anthropics/skills
`skill-creator` methodology — it measures three separate things:

1. **Triggering** — does the skill load when it should (and not when it
   shouldn't)? Harness: `evals/trigger-eval.json` with ~10 realistic
   should-trigger prompts ("scrape my dashboard behind SSO", "watch what API
   this page calls") and ~10 near-miss should-NOT-trigger prompts (generic web
   questions, Playwright test authoring, curl-able public APIs). Run each 3×
   via `claude -p --output-format stream-json` and detect the Skill tool_use
   event (skill-creator's `run_eval.py` pattern). Metric: precision/recall.
   Anthropic documents under-triggering as the default failure mode;
   `run_loop.py` can optimize the description against a train/test split.
2. **Execution** — once loaded, does the agent drive reins correctly?
   Browser evals against live sites are flaky, so favor trajectory and
   artifact assertions over output diffs:
   - **Fixture site.** A tiny local app (login wall, paginated table, form
     wizard, JSON API, dialog traps) served by the eval runner —
     deterministic ground truth.
   - **Assertions.** Did the transcript call `snapshot` before `click`? Did it
     re-snapshot after nav? Did it produce the exact JSON the fixture defines?
     Exit codes and artifacts, not prose grading, wherever possible.
   - The existing `integration.test.ts` (daemon + stand-in WS extension)
     already fakes the browser end — reuse it for a cheap deterministic tier;
     run a real-browser tier less often.
3. **Uplift** — is the skill better than no skill? Paired runs (with-skill vs
   `without_skill` baseline, fresh sessions, parallel subagents), graded and
   aggregated to pass-rate / tokens / time, mean ± stddev across repeats
   (skill-creator's `aggregate_benchmark.py` shape). Variance analysis
   separates flaky evals from real regressions.

Operationalize: `evals/` directory in-repo, `pnpm eval` runner, weekly CI run
with pinned model IDs (silent model updates should surface as eval diffs, not
user bug reports), plus on-demand before each skill edit. Publish the
scorecard in the README — nobody else in the niche has public skill evals;
it's both quality control and marketing.

## Phase 3 — Depth: close the capability gaps (v0.5)

Informed by the comparison table; promote by observed demand, not speculation.

- **Network bodies and headers.** The skill's own gotchas section admits
  `network` records method/URL/status only — the biggest day-to-day gap.
  HAR-style capture (`reins network --har`, `reins network --body <id>`)
  covers reverse-engineering workflows without the `eval`-fetch detour.
- **Batch mode.** Chrome DevTools CLI v1 and agent-browser both bet on
  batching actions per invocation to cut round-trips. A
  `reins run <script>` (or stdin) executing a short action list against one
  tab would drop the agent's tool-call count for multi-step flows.
- **Downloads + PDF** as curated commands (both exist via `cdp` today).
- **WebMCP watch.** Chrome 149 origin trial lets sites expose
  `navigator.modelContext` tools. When it matures, `reins tools <tab>` —
  list and call site-declared tools — turns a structural threat (sites
  bypassing DOM automation) into a feature.

## Phase 4 — Reach: distribution and ecosystem (v0.6+)

- **Discovery.** The funnel is installs-without-visitors; invert it: launch
  post (the CLI-vs-MCP token story + security model is the angle), demo
  recordings on the landing page, recipes gallery in docs (the SKILL.md
  recipes are the best marketing copy the project has). Groundwork landed:
  landing revamp + permissions docs (#17), light theme (#18), changelog page
  (#19) — the site is launch-ready; the launch post is not written.
- **Cross-agent eval matrix.** The skill claims Claude Code / Cursor / Codex /
  Copilot compatibility; actually run the trigger+execution evals per harness
  and publish the matrix. "Tested on N agents" is a differentiator the
  clones can't cheaply copy.
- **Windows/Linux confidence.** Spec says Windows is best-effort; promote to
  tested-in-CI.
- **Later, by demand only:** Firefox (WebExtensions debugger API differs),
  session recording/replay, an opt-in MCP shim for agents without shell
  access.

## Non-goals

- Headless fleets, CI browser automation, request mocking — agent-browser and
  playwright-mcp own that ground; reins is "act as me, in my browser."
- A product UI. reins stays plumbing; the popup stays a status light and kill
  switch.
- Telemetry. The privacy stance is part of the differentiation.

## Sources

- Skill eval methodology: anthropics/skills `skills/skill-creator` (SKILL.md,
  `scripts/run_eval.py`, `scripts/run_loop.py`,
  `scripts/aggregate_benchmark.py`, `agents/grader.md`);
  https://docs.claude.com/en/docs/agents-and-tools/agent-skills/best-practices;
  https://mlflow.org/blog/evaluating-skills-mlflow/ (trace-based judging);
  https://scottspence.com/posts/measuring-claude-code-skill-activation-with-sandboxed-evals
  (activation detection via stream-json); mgechev/skillgrade (deterministic +
  rubric graders).
- Landscape: vercel-labs/agent-browser, ChromeDevTools/chrome-devtools-mcp v1
  (CLI + skills), microsoft/playwright-mcp, freshtechbro/opendevbrowser,
  browser-use/open-browser-use; Claude in Chrome permission model
  (https://support.claude.com/en/articles/12902446); Brave's Comet
  prompt-injection research (https://brave.com/blog/comet-prompt-injection/);
  WebMCP origin trial (https://developer.chrome.com/docs/ai/webmcp).
