# `reins do` vs. Claude driving reins step by step

Measured 2026-09-28 on 38 browsing tasks in the maintainer's real Chrome. One
arm hands the whole goal to `reins do`: TypeSafe's Jev model picks every
action. The other arm has Claude Code drive the same kind of tab with reins
step commands, one shell call per command. Both arms are scored by the same
independent JavaScript check on the page the run ended on.

This replaces the first version of this benchmark (4 tasks, 2026-09-27),
which is summarised at the end under
[Earlier version of this benchmark](#earlier-version-of-this-benchmark-v1).

Read [Limitations](#limitations) before quoting any number from this page.

The runs behind these numbers: `reins do` on the 30 dev tasks, 5 runs each, on
the final code (e9331fa); `reins do` on the 8 unseen holdout3 tasks, 5 runs
each, the set's first and only run (f1af855, before round 5); Claude step by
step on all 38 tasks, 3 runs each. Raw run files aren't kept in the repo; the
commands under [Reproduce](#reproduce) regenerate them.

The runner is [`packages/cli/scripts/bench-do.mjs`](../../packages/cli/scripts/bench-do.mjs);
the tasks, their goals and their checks are in
[`packages/cli/scripts/bench/tasks.mjs`](../../packages/cli/scripts/bench/tasks.mjs).

## Headline

- **Dev set (30 tasks, tuned on for five rounds):** `reins do` passed
  **124 of 150 runs (82.6%)**. Claude step by step passed 81 of 90 (90%);
  81 of 87 (93.1%) without fx-newtab, a task its rules made impossible (see
  [Results](#results)).
- **Unseen set (holdout3, 8 tasks, never looked at while fixing):** `reins do`
  passed **35 of 40 runs (87.5%)** on its first and only run. Claude step by
  step passed 21 of 24 (87.5%).
- **Speed and cost, on the 30 tasks both arms passed at least once:** the
  median task was **4.6x faster** with `reins do` (range 2.4x to 22.6x) and
  **111x cheaper** in model spend (range 44x to 535x). Pooled over those
  tasks' passing runs, the median `reins do` run took 5.7 s and the median
  Claude run 24.5 s. The cost counts only Jev for `reins do`; the calling
  agent's own turn is not in it.
- **The self-check:** of the 166 `reins do` runs that ended `done`, 17 were
  wrong, and all 17 carried a self-check under 0.5 ("unsure"); 20 of the 149
  right ones (13%) were marked unsure too.

In total the `reins do` arm made 1,106 Jev calls over 190 runs for 7,434,019
input tokens, about $0.32. The step-by-step arm spent $21.83 of Claude over
114 runs.

Each arm also failed tasks the other passed. `reins do` never passed
fx-datepicker, fx-filters, arxiv, fx-orders or xe; Claude never passed
openlibrary or fx-wizard (and could not attempt fx-newtab). Why, per task, is
under [Limitations](#limitations) and
[Where step by step failed](#where-step-by-step-failed-and-reins-do-passed).

## Method

**The suite.** 38 tasks in two tiers.

- **Fixture tier (11 tasks):** local pages served by the runner on
  127.0.0.1, each built around one widget that trips browser agents:
  an autocomplete that only commits on a picked suggestion, a calendar
  popover with a Done button, a consent modal over a search form, a
  search with a language filter and a sort menu, a link that opens a new
  tab, a three-step form, a "Delete draft" button (the correct outcome is a
  stop), a tabbed settings panel with switches and a Save button, a
  paginated table whose target row is on page 2, an FAQ accordion with a
  feedback vote, and a modal project wizard with a custom radio group.
  The pages copy real sites' markup (`role=listbox` options, `menuitemradio`
  menus, `role=switch`, `role=radio` cards).
- **Live tier (27 tasks):** public sites, no logins, no purchases: Google
  Flights, Wikipedia, GitHub search, BBC Weather, arXiv, npm, MDN, Cambridge
  Dictionary, Hugging Face, Amazon, Hacker News, Wolfram|Alpha, the Python
  docs, PyPI, a date calculator, lit.dev, MusicBrainz, Open Library,
  crates.io, IANA's root zone database, OpenStreetMap, Project Gutenberg,
  HN Search (Algolia), Debian packages, the Rust std docs, pkg.go.dev and
  xe.com.

**The checks.** Every task has a JavaScript check evaluated in the tab the
run ended on (the new tab, when a link opened one). Each check was validated
without `reins do` before the task was used: false on the start page, false
on near-miss states (search run but not sorted, the wrong edition opened,
the date picked but not confirmed, a second project created), true on a goal
state reached by URL or by driving the page with `reins eval`. The checks and
a plain-words note for each are in `tasks.mjs`.

**A pass.** A run passes only when the check returns true and the arm
finished on its own inside its time limit. A timeout never counts, even if
the page ended up right (none happened in these runs). For fx-risky the
correct outcome is a stop before the delete: `reins do` must end
`risky_action` and the draft must still exist; Claude, which has no status,
passes when the page check says the draft still exists and no confirm prompt
opened.

**Runs.** `reins do`: 5 runs per task. Claude: 3 runs per task, because each
run costs about a hundred times more. Every run opens the task's start URL in
a fresh tab, waits 2 s outside the clock, then times the arm from spawn to
exit. Times are the runner's wall clock (`ms`).

**The arms.**

- **`reins do`:** one call, `reins do '<goal>' --fill name=value … --timeout
  60 --tab <id> --json` (timeout 90 s for flights, amazon, wolframalpha and
  xe). Jev picks each action; reins validates every answer and re-checks
  every element before acting. At most 30 steps.
- **Claude step by step:** `claude -p` (Claude Code 2.1.283, model
  claude-opus-5-5) with the same goal and fill values in its prompt, allowed
  only the reins step commands (snapshot, click, type, fill, select, press,
  hover, scroll, wait, text, screenshot), one command per Bash call,
  `--restricted` with an explicit allowlist, `reins do` denied, no
  navigation by URL, told not to touch any other tab, told to stop before
  anything irreversible, and capped at $2 per run (no run hit the cap; the
  dearest was $0.91). Its cost is Claude Code's reported
  `total_cost_usd` for the whole session.

**Dev and holdout.** The dev set is what the fixes were tuned against. A
holdout set is used once: its first run is the generalisation number, and
after it the set has been seen, its failures discussed, and it is folded into
dev. That happened twice. Holdout v1 (7 tasks) was folded in after its first
run (25/35 on 48c758d); holdout2 (8 tasks) after its first run (16/40 on
3c8a364). Holdout3 (8 tasks) was frozen on 2026-09-28 while HEAD was f1af855,
before any `reins do` run on it, and its checks were validated without
`reins do`. Its one run is the unseen number on this page. It was measured on
f1af855; round 5's two changes came after it.

**Machine and network.** The maintainer's laptop (macOS), reins 0.5.0, Node
v24.18.0, on a residential network in India. TypeSafe runs Jev on the US West
Coast, so every Jev call crossed the Pacific, and the `reins do` times include
that. Runs on 2026-09-28 (UTC): holdout3 11:31 to 11:37, the xe re-run 11:37,
dev 11:41 to 12:07, Claude 12:11 to 13:42.

**Money.** Jev is priced at $0.042 per million input tokens, output free
([TypeSafe's announcement](https://typesafe.ai/blog/introducing-system-one-models-and-jev),
read 2026-09-27; TypeSafe says it cannot prove the price is not subsidised).
Tokens are the API's own `usage.input_tokens`, summed per run, as
`reins do --json` reports them in `inputTokens`.

**Arithmetic.** Medians are over passing runs only, lower-middle for even
counts (the runner's rule). Times are shown to 0.1 s. Jev cost per run is
rounded up to the next $0.00001 and Claude cost per run rounded down to the
$0.001, so neither rounding favours `reins do`. Speed-ups and cost ratios are
computed from unrounded medians and truncated, never rounded up.

## Results

`reins do` columns: runs passed, then the median time, Jev input tokens and
Jev cost of the passing runs. Claude columns: runs passed, then the median
time, cost and turns of the passing runs. Speed-up and cost ratio are Claude's
median over `reins do`'s, shown only where both arms passed at least once.

| task | tier | set | `reins do` passed | `reins do` median | Jev tokens | Jev cost / run | Claude passed | Claude median | Claude cost / run | Claude turns | speed-up | cost ratio |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| fx-autocomplete | fixture | dev | 5/5 | 3.9 s | 8,339 | $0.00036 | 3/3 | 39.5 s | $0.144 | 15 | 10.2x | 413x |
| fx-datepicker | fixture | dev | 0/5 | - | - | - | 3/3 | 25.1 s | $0.087 | 12 | - | - |
| fx-consent | fixture | dev | 5/5 | 5.3 s | 9,623 | $0.00041 | 3/3 | 31.3 s | $0.069 | 9 | 5.9x | 172x |
| fx-filters | fixture | dev | 0/5 | - | - | - | 3/3 | 55.7 s | $0.134 | 12 | - | - |
| fx-newtab ¹ | fixture | dev | 5/5 | 6.1 s | 12,993 | $0.00055 | 0/3 | - | - | - | - | - |
| fx-form | fixture | dev | 5/5 | 8.1 s | 22,227 | $0.00094 | 3/3 | 141.5 s | $0.324 | 40 | 17.4x | 347x |
| fx-risky ² | fixture | dev | 5/5 | 0.7 s | 1,361 | $0.00006 | 3/3 | 8.0 s | $0.030 | 2 | 12.2x | 535x |
| fx-settings | fixture | dev | 5/5 | 3.4 s | 8,795 | $0.00037 | 2/3 | 45.8 s | $0.136 | 17 | 13.5x | 369x |
| fx-orders | fixture | dev | 0/5 | - | - | - | 3/3 | 23.7 s | $0.084 | 10 | - | - |
| flights | live | dev | 5/5 | 15.9 s | 105,994 | $0.00446 | 3/3 | 64.4 s | $0.559 | 28 | 4.0x | 125x |
| wikipedia | live | dev | 5/5 | 4.1 s | 34,846 | $0.00147 | 3/3 | 19.3 s | $0.101 | 7 | 4.6x | 69x |
| github | live | dev | 4/5 | 11.0 s | 51,100 | $0.00215 | 3/3 | 34.6 s | $0.170 | 17 | 3.1x | 79x |
| cookies | live | dev | 5/5 | 8.5 s | 32,297 | $0.00136 | 3/3 | 22.6 s | $0.151 | 8 | 2.6x | 111x |
| arxiv | live | dev | 0/5 | - | - | - | 3/3 | 53.0 s | $0.291 | 25 | - | - |
| npm | live | dev | 5/5 | 3.5 s | 16,441 | $0.00070 | 3/3 | 31.7 s | $0.150 | 9 | 8.9x | 217x |
| mdn ³ | live | dev | 5/5 | 4.8 s | 32,335 | $0.00136 | 1/3 | 108.1 s | $0.492 | 34 | 22.6x | 362x |
| cambridge | live | dev | 5/5 | 6.5 s | 25,691 | $0.00108 | 3/3 | 27.8 s | $0.107 | 9 | 4.2x | 100x |
| huggingface ³ | live | dev | 1/5 | 5.1 s | 76,747 | $0.00323 | 3/3 | 21.3 s | $0.171 | 8 | 4.1x | 53x |
| amazon | live | dev | 5/5 | 9.3 s | 38,873 | $0.00164 | 3/3 | 23.2 s | $0.165 | 9 | 2.5x | 101x |
| hackernews | live | dev | 5/5 | 3.8 s | 48,945 | $0.00206 | 3/3 | 20.0 s | $0.133 | 8 | 5.2x | 65x |
| wolframalpha | live | dev | 5/5 | 6.8 s | 36,208 | $0.00153 | 3/3 | 18.9 s | $0.068 | 7 | 2.7x | 44x |
| pydocs | live | dev | 5/5 | 5.9 s | 46,391 | $0.00195 | 3/3 | 23.5 s | $0.114 | 10 | 3.9x | 58x |
| pypi | live | dev | 5/5 | 7.4 s | 24,222 | $0.00102 | 3/3 | 30.1 s | $0.142 | 12 | 4.0x | 139x |
| datecalc | live | dev | 4/5 | 10.1 s | 143,793 | $0.00604 | 3/3 | 115.7 s | $0.572 | 47 | 11.4x | 94x |
| lit | live | dev | 5/5 | 7.7 s | 38,667 | $0.00163 | 3/3 | 42.3 s | $0.203 | 18 | 5.4x | 125x |
| musicbrainz | live | dev | 5/5 | 4.9 s | 60,964 | $0.00257 | 3/3 | 17.4 s | $0.127 | 8 | 3.5x | 49x |
| openlibrary | live | dev | 5/5 | 14.6 s | 72,927 | $0.00307 | 0/3 | - | - | - | - | - |
| crates | live | dev | 5/5 | 6.7 s | 28,637 | $0.00121 | 3/3 | 25.1 s | $0.149 | 10 | 3.7x | 124x |
| iana | live | dev | 5/5 | 1.8 s | 9,814 | $0.00042 | 3/3 | 13.5 s | $0.208 | 5 | 7.7x | 505x |
| osm | live | dev | 5/5 | 6.4 s | 26,382 | $0.00111 | 3/3 | 21.9 s | $0.088 | 11 | 3.4x | 80x |
| fx-faq | fixture | holdout3 | 5/5 | 2.5 s | 8,796 | $0.00037 | 3/3 | 21.4 s | $0.114 | 8 | 8.5x | 310x |
| fx-wizard | fixture | holdout3 | 5/5 | 4.6 s | 13,056 | $0.00055 | 0/3 | - | - | - | - | - |
| gutenberg | live | holdout3 | 5/5 | 2.8 s | 18,850 | $0.00080 | 3/3 | 19.0 s | $0.096 | 8 | 6.7x | 121x |
| hnsearch | live | holdout3 | 5/5 | 8.9 s | 72,835 | $0.00306 | 3/3 | 29.1 s | $0.184 | 13 | 3.2x | 60x |
| debian ⁴ | live | holdout3 | 5/5 | 4.5 s | 33,937 | $0.00143 | 3/3 | 24.5 s | $0.150 | 13 | 5.4x | 105x |
| rustdocs | live | holdout3 | 5/5 | 5.9 s | 45,163 | $0.00190 | 3/3 | 46.8 s | $0.288 | 15 | 7.9x | 151x |
| gopkg | live | holdout3 | 5/5 | 9.1 s | 30,018 | $0.00127 | 3/3 | 22.6 s | $0.099 | 10 | 2.4x | 79x |
| xe | live | holdout3 | 0/5 | - | - | - | 3/3 | 37.4 s | $0.289 | 19 | - | - |

1. fx-newtab is not a fair comparison. Its link opens the docs in a new tab,
   and the step-by-step prompt forbids touching any tab but the one it was
   given, so Claude stopped every time and said so. It is in the Claude
   totals below, and the totals are also given without it.
2. fx-risky's correct outcome is a stop. `reins do` ended `risky_action` 5 of
   5 times without clicking. Claude stopped before the delete 3 of 3 times.
   The runner first scored those 3 Claude runs as failures, applying a
   `reins do`-only status rule to them; they are counted here by the page
   check, as the runner now does (e382fbd).
3. One passing run only, so that median is a single sample: mdn's Claude
   figures, huggingface's `reins do` figures.
4. Every debian run ended with status `left_site`, not `done`: the search
   form on www.debian.org submits to packages.debian.org, and on f1af855
   `reins do` stopped there as a site change. The page it stopped on was the
   goal, so the check passes. Round 5 treats a leading `www.` as the same site
   (8d69688); a later confirmation run ended `done` 5 of 5, but that run is
   not counted, because the holdout is only measured once.

Totals:

| set | tier | `reins do` | Claude | Claude without fx-newtab |
|---|---|---|---|---|
| dev | fixture | 30/45 | 23/27 | 23/24 |
| dev | live | 94/105 | 58/63 | 58/63 |
| dev | all | **124/150 (82.6%)** | **81/90 (90%)** | 81/87 (93.1%) |
| holdout3 | fixture | 10/10 | 3/6 | 3/6 |
| holdout3 | live | 25/30 | 18/18 | 18/18 |
| holdout3 | all | **35/40 (87.5%)** | **21/24 (87.5%)** | 21/24 |
| both | all | 159/190 | 102/114 | 102/111 |

Per set, the median task speed-up is 4.2x on dev (24 tasks) and 5.4x on
holdout3 (6 tasks); the median cost ratio is 111x on dev and 105x on
holdout3.

Spend:

- `reins do`, dev: 901 Jev calls, 6,256,057 input tokens, $0.263.
- `reins do`, holdout3: 205 Jev calls, 1,177,962 input tokens, $0.050.
- Claude, all 38 tasks: 114 runs, 1,728 turns, $21.83. The dearest run was
  openlibrary #1 (52 turns, $0.91, failed); the slowest was openlibrary #3
  (318.9 s, failed).

For reference, on the same code as the holdout3 run (f1af855) the dev set
scored 122/150 (81.3%).

### The self-check

Every `done` is put back to Jev once as a yes/no question ("every
requirement in the goal is visibly satisfied on this page"), and the answer's
probability is returned as `doneConfidence`. Below 0.5 the human output reads
`done (unsure: self-check 0.43)` and the `next:` line says to verify.
Recomputed from the per-run `result.json` files of the dev and holdout3 runs:

| `done` runs | right (check passed) | wrong (check failed) |
|---|---|---|
| self-check 0.5 or more | 129 | 0 |
| self-check under 0.5 ("unsure") | 20 | 17 |
| total | 149 | 17 |

- The 17 wrong ones: fx-filters ×5 (0.32 to 0.49), fx-datepicker ×5 (0.12
  to 0.14), arxiv ×5 (0.38 to 0.45), github ×1 (0.44), huggingface ×1
  (0.08). The highest, 0.49, sits one hundredth under the line.
- The 20 right-but-unsure ones are four whole tasks: cookies ×5 (0.39 to
  0.44), fx-newtab ×5 (0.38 to 0.49), wolframalpha ×5 (0.11 to 0.18) and
  gutenberg ×5 (0.27 to 0.38). Unsure means "check the page", not "failed".
- The three `stuck` runs (huggingface) carried a self-check of 0.04. Other
  stops (`blocked`, `budget`, `needs_text`, `left_site`, `risky_action`)
  carry none.

### Where step by step failed and `reins do` passed

Read from each failed run's final reply. Several of these point at reins'
own step commands rather than at Claude's reasoning: `reins snapshot`, the
command the step-by-step arm reads pages with, does not look inside shadow
roots, while `reins do`'s observation does (it learned to in rounds 3 and 4,
below).

- **fx-newtab, 0/3.** The link opens a new tab; the prompt forbids other
  tabs. Claude stopped and asked (3 to 4 turns). Not a fair task for this arm.
- **openlibrary, 0/3.** Run 1 (52 turns, $0.91) searched but could never
  open the "Sort by" menu: its options are inside a web component and never
  appeared in a snapshot. Run 2 went through Advanced Search, landed on a
  "Verify you are human" page and stopped rather than click it. Run 3 never
  found the search field (it sits in a web component's modal) and stopped on
  the home page.
- **fx-wizard, 0/3.** Runs 1 and 2: clicking the "Team" visibility card came
  back "element has zero size", Next still advanced with the default
  Private, and Back and Close could not be used; Claude stopped on the review
  step rather than create a Private project. Run 3 pressed Enter and then
  Space on "Create project", both worked, and it created the project twice
  (the check wants exactly one); Claude noticed and reported it.
- **mdn, 1/3.** Runs 2 and 3 never found MDN's search box (a web component):
  the search button reported zero size, `reins press /` was rejected as an
  unknown key, and no selector reached the input. Run 1 got there in 34
  turns.
- **fx-settings, 2/3.** Run 2 saw the switches without names, a click on
  the right one reported zero size, and a selector probe toggled a different
  switch; Claude stopped without saving and said which switch might have
  changed.

No step-by-step run hit its $2 cap or the runner's 600 s limit; each
failure is a stop Claude chose, with a reply saying why.

## How it got here

`reins do` was tuned in five rounds on the dev set. Each change was tried
alone and A/B'd on the whole dev set (3 runs per task in round 1, 5 after
that), and kept when the total rose by at least 3 runs with no task at 4/5 or
better falling below 3/5 and fx-risky still stopping every time. Three changes
were kept below that bar on judgment, because their target task moved from
0/5 and the drops elsewhere were traced to unrelated coin flips; they are
marked below and were flagged to the maintainer at the time. Tasks were only
ever replaced or corrected when the task itself was broken (a past date, a
checker bug, a page TypeSafe's API refused, a missing fill), never because
`reins do` failed them.

The dev set grew as holdouts were folded in, so the pass rates below are not
one series on one set.

| stage | code | dev set | dev result | holdout first run |
|---|---|---|---|---|
| baseline | 7b9d105 | 15 tasks × 3 | 26/45 (57.7%) | |
| after round 1 | 031e35c | 15 × 3 | 33/45 (73.3%) | |
| after round 2 | 307e204 | 15 × 5 | 61/75 (81.3%) | |
| holdout v1 run | 48c758d | 15 × 5 | 58/75 (77.3%) | holdout v1: 25/35 (71.4%) |
| after round 3 | 3c8a364 | 22 × 5 | 87/110 (79.0%) | holdout2: 16/40 (40%) |
| round 4 start | 3c8a364 | 30 × 5 | 101/150 (67.3%) | |
| after round 4 | f1af855 | 30 × 5 | 122/150 (81.3%) | holdout3: 35/40 (87.5%) |
| after round 5 | e9331fa | 30 × 5 | 124/150 (82.6%) | |

The kept changes, with what each moved in its own A/B:

| change | commit | round | what it moved |
|---|---|---|---|
| "Accept" inside a cookie or consent banner is not a risky click | ffdb1b9 | 1 | 26 to 27 of 45; lets consent walls like Cambridge's be dismissed without the goal naming the button |
| The observation waits for a loading or navigating tab, and re-attaches after Chrome drops the debugger session | 384ce2b | 1 | amazon 1/3 to 3/3; datecalc's page became readable at all |
| A stop verdict right after typing a search query submits it first | cc8217a | 1 | flights 1/3 to 2/3; github's "blocked with the query typed" runs became passes |
| After a click or a typed value, wait for the page to settle | 031e35c | 1 | flights 2/3 to 3/3, github 0/3 to 2/3, huggingface 1/3 to 2/3 (npm 3/3 to 2/3) |
| Type key by key, and resume after a dropped debugger session | d3401e3 | 2 | fields that rewrite their value on keyup keep it; 52 to 55 of 75, the gain on the noisy tasks |
| Name an unlabelled control by its table row or group, never by its options | 547849b | 2 | datecalc 0/20 to 8/10 over two runs (kept below the bar) |
| DONE self-check (307e204), then report-only (48c758d) | 307e204, 48c758d | 2 | no pass moved; refusing a DONE never changed an outcome, so it now only reports `doneConfidence` |
| A rounded-probability tie is not an unusable answer | 21a1fcf | 2 to 3 | removes an `error` stop seen in about 1 run in 6 in round 2 |
| The observation reads open shadow roots | 08b668d | 3 | mdn 0/5 to 5/5 (kept below the bar) |
| A stuck run is self-checked and ends `done` when its page is the goal | 3c8a364 | 3 | changed no outcome in its A/B; adds a self-check to `stuck` results |
| A control is named by what its shadow root or slot renders | 3c4e846 | 4 | lit 0/5 to 4/5 (kept below the bar) |
| A link to a new tab is opened by the extension, not by Chrome | a77ab0d | 4 | no pass change; Chrome no longer raises itself over the user's app when a run follows a `target=_blank` link |
| Off-screen pagers and controls named by a goal word are in the observation | e9d0438 | 4 | iana 0/5 to 5/5; +8% tokens per call |
| The observation waits for in-flight XHR and fetch requests | 47840f2 | 4 | osm 2/5 to 5/5; median run +20% |
| No refocus click on the field just typed into, and clicks reach slotted web-component controls (a pair) | f1af855 | 4 | openlibrary 0/5 to 4/5; each half alone moved nothing |
| A leading `www.` never makes a different site | 8d69688 | 5 | cannot move dev; debian `left_site` to `done` in a confirmation run (not counted) |
| A field whose fill head says NONE retargets to a field whose head names a fill | e9331fa | 5 | fired on no dev run; did not fix xe |

Round 5's total rose 122 to 124, which the traces put down to noise on
wolframalpha: neither round-5 mechanism fired on a dev task.

Tried and reverted (each with its A/B in the fix-loop log):

- Observe settle without the re-attach: fx-form 3/3 to 1/3 (a password-manager
  frame drops the debugger session). Replaced by the version with re-attach.
- Offer the "Open field" click only on fields that open something: flights
  2/3 to 0/3.
- Stale-element guard scoped to row containers: no change (30 vs 30).
- Page text joined per block, tried twice: arxiv's failure changed shape
  but did not turn into a pass; no gain.
- Row/group naming, first try: reverted on a github swing, kept in round 2
  after a pooled re-test (above).
- Rounded-tie tolerance, first two tries: no gain because the error is
  rare; kept later (21a1fcf) because the error is real.
- Key-by-key typing without the resume: fx-form 5/5 to 1/5.
- A 300 ms grace for a click's navigation to start: no gain.
- Stable select option ids, and refusing to re-select the current option:
  datecalc 4/5 to 2/5 and 1/5.
- A stuck self-check that credits the run's recorded actions: no outcome
  changed.
- The refocus rule alone and the slotted-click fix alone: no gain each;
  kept together.

## Limitations

**Tasks `reins do` still fails, and why (from the traces):**

- **fx-filters, 0/5.** Jev types the query, clicks the "TypeScript" filter
  before submitting it (the page drops unsubmitted text, as GitHub does),
  sorts, retypes and submits. The final URL has the query and the sort but no
  language filter. Every run ends `done`, self-check 0.32 to 0.49.
- **fx-datepicker, 0/5.** Jev opens the calendar, goes forward two months,
  picks November 18, then answers DONE (in run 1, 0.69 against CLICK 0.31)
  without pressing the calendar's Done button, which is in its observation. Every
  run ends `done`, self-check 0.12 to 0.14.
- **arxiv, 0/5.** Jev searches, then opens arXiv:2609.13531, a different
  paper whose title starts with the same words. Earlier traces showed the
  wanted paper is not on the newest-first results page at all, and the sort
  control is offered and never chosen. Every run ends `done`, self-check 0.38
  to 0.45.
- **fx-orders, 0/5.** The order is on page 2 of a table. The pager ("2",
  "Next page") is in the viewport and among Jev's click candidates (checked
  against the screenshot and trace in round 4), and Jev answers
  BLOCKED (0.94 to 0.95) at step 0, every run. No self-check runs on a
  `blocked` stop; the stop itself is the signal.
- **huggingface, 1/5.** The page has two search boxes. In 4 runs Jev typed
  into the site-wide one, whose Enter opens the top model page, then clicked
  "Open Search…" until it was `stuck` (×3, self-check 0.04) or answered
  `done` there (×1, self-check 0.08). The one pass used the model list's own
  "Filter by name" field.
- **github, 4/5.** The miss typed the query, then followed the "advanced
  search" link, which drops it; the results were TypeScript by stars without
  "browser automation". `done`, self-check 0.44. After typing, Jev's choice
  between that link and giving up (which reins turns into a submit) is a
  near tie, so this flips from run to run.
- **datecalc, 4/5.** The miss clicked Calculate before setting the end day,
  then flipped the end-day select between 1 and 2 until the 30-step budget
  ran out (`budget`).
- **xe, 0/5 (holdout3).** Stops `needs_text` at step 0: xe gives its amount
  input the label "Receiving amount", the same label as the converted
  output, so no field matches the `amount` fill. The xe task first lacked
  the currency fills; with them added, a re-run was still 0/5. Unsolved: overriding a
  site's explicit label with nearby text is not a rule we could make general.

**`done` is Jev's opinion.** On this suite every wrong `done` was marked
unsure and no sure `done` was wrong, but that is 166 runs on 38 tasks, and
the 17 wrong ones come from 5 tasks. Verify the page before reporting
success, and treat an unsure `done` as a request to look.

**Every text value comes from `--fill`.** `reins do` never makes up text.
A field the fills do not cover stops the run with `needs_text`; a site that
mislabels its fields (xe) stops it even when the value was given.

**What it can see and do.** It reads open shadow roots, never closed ones.
Links that open a new tab are opened by the extension, but a page that opens
a tab from script (`window.open`) can still bring Chrome to the front. The
risky-click stop is a heuristic on English words (buy, pay, send, delete…)
and unlabelled buttons; other languages and odd labels can slip past it.

**A small benchmark.** 38 tasks, one machine, one network, one day. 5 runs
per task for `reins do`, 3 for Claude, so one run is 20 or 33 points on a
task. Live sites change: a different first story on Hacker News, a changed
search index or a new consent banner can move a task tomorrow. The fixture
pages were written for this benchmark, and they, the checks and every fix
were written by Claude agents working for the maintainer.

**Tuned on dev.** Five rounds of fixes were tuned against the dev set, so
its 82.6% is an optimistic number. The unseen figure (35/40) is the one that
says how it generalises, and it was measured on f1af855, before round 5. It
is 8 tasks: one task (xe) is 5 of its 40 runs, and its 5 debian passes ended
`left_site` rather than `done` (note 4 under Results).

**What the cost comparison leaves out.** The Jev figure is only Jev. The
agent that calls `reins do` still spends its own turn to issue the command,
read the result and verify the page, and that is not counted. The Claude
figure is the whole Claude Code session: its own system prompt and tool
definitions included (17 of the 114 replies mention the maintainer's
claude.ai connectors, so their definitions were in the context too).

**What the step-by-step arm measures.** It is Claude plus reins' step
commands, and some of its failures are the step commands': `reins snapshot`
does not read shadow roots (mdn, openlibrary) and reported "zero size" on
controls in fx-wizard and fx-settings. A better step toolkit, or a Claude
allowed to navigate by URL or use other tabs, would score higher and differ
in speed and cost.

**Privacy.** `reins do` sends the goal, your `--fill` names and values, the
tab's URL and title, the visible text and the labels and values of the
page's controls to TypeSafe. The full list is in
[the `reins do` section of the security page](https://reins.tech/docs/security#reins-do)
and [PRIVACY.md](../PRIVACY.md). The step-by-step arm sends page content to
Anthropic. Either way it is opt-in.

## Reproduce

```bash
# reins do on the dev set, 5 runs per task, with the Jev trace per run
REINS_JEV_TRACE=/tmp/jev-trace.jsonl reins restart
node packages/cli/scripts/bench-do.mjs --arm do --set dev --runs 5 \
  --trace /tmp/jev-trace.jsonl --out r5.json

# reins do on holdout3 (no longer unseen: it has been run once)
node packages/cli/scripts/bench-do.mjs --arm do --set holdout3 --runs 5 --out h3.json

# Claude step by step on every task, 3 runs per task
node packages/cli/scripts/bench-do.mjs --arm manual --set all --runs 3 --out manual-v2.json
```

Other flags: `--tier fixture|live`, `--tasks id1,id2`,
`--claude-budget-usd 2`, `--out-dir` (per-run folders with `result.json`, a
screenshot and the Jev trace lines), and `--dry` for a self-test with no
browser and no spend.

It needs a TypeSafe key (`reins key set typesafe`) for the `reins do` arm
and `claude` on PATH for the other. It costs money: about $0.32 of Jev for
the 190 `reins do` runs here, $21.83 of Claude for the 114 step-by-step runs.
It opens tabs in your real browser, in the foreground, for the whole run
(about 25 minutes for dev, 5 for holdout3 and 90 for the Claude arm here). The fixture
tier needs nothing but the runner, which serves the pages itself.

## Earlier version of this benchmark (v1)

The first version (2026-09-27) ran 4 live tasks (flights, wikipedia,
github, cookies) 5 times per arm, on the builds of that day. On the build
that shipped then (87ac8b8) `reins do` passed 14/20 and Claude step by step
19/20; github was 1/5 for `reins do` (the advanced-search detour above), and
on the tasks it passed `reins do` was 4.6x to 7.9x faster. It had no holdout
set and no fixture tier, which is why v2 exists.
