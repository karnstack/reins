# `reins do` vs. Claude driving reins step by step

Measured 2026-09-27. Four browsing tasks, each run five times per arm in the
maintainer's real Chrome. One arm hands the whole goal to `reins do` (TypeSafe's
Jev model picks every action). The other has Claude Code drive the same tab with
reins step commands, one shell call per command.

Raw data sits next to this file:

- [`2026-09-reins-do-run1.json`](./2026-09-reins-do-run1.json): run 1, both arms, all four tasks.
- [`2026-09-reins-do-run2-do.json`](./2026-09-reins-do-run2-do.json): run 2, `reins do` arm only, after a fix wave.

The script is [`packages/cli/scripts/bench-do.mjs`](../../packages/cli/scripts/bench-do.mjs).

## Headline

On the three tasks Jev could route (flights, wikipedia, cookies), one `reins do`
call finished in 2.3 to 7.5 s where a step-by-step session took 17.3 to 71.1 s:
6.7 to 9.5 times faster, and about 90 to 140 times cheaper in model spend
(Jev's share, not the calling agent's turn). On the fourth task (github, a search
with a language filter and a sort), `reins do` failed 5 out of 5 runs and
step-by-step passed 5 out of 5. Both facts are the result.

## Results

Medians over verified runs (lower-middle median for even counts). Seconds are
wall-clock from the arm's start to its exit, with the tab's initial 2 s load
outside the clock.

| task | reins do passed | step-by-step passed | reins do median | step-by-step median | speed-up | Jev calls (median) | Jev input tokens (median) | Jev cost / run | Claude cost / run (median) | Claude turns (median) | cost ratio |
|---|---|---|---|---|---|---|---|---|---|---|---|
| flights (Google Flights, ZRH to LON one-way Nov 20) | 5/5 | 4/5 | 7.5 s | 71.1 s | 9.5x | 13 | 99,690 | $0.0042 | $0.57 | 29 | ~135x |
| wikipedia (open "Gödel's incompleteness theorems") | 5/5 | 5/5 | 2.7 s | 18.3 s | 6.7x | 4 | 38,170 | $0.0016 | $0.14 | 7 | ~88x |
| cookies (BBC Weather, dismiss consent, Zurich forecast) | 5/5 | 5/5 | 2.3 s | 17.3 s | 7.6x | 4 | 26,754 | $0.0011 | $0.16 | 7 | ~143x |
| github (repos "browser automation", TypeScript, most stars) | 0/5 | 5/5 | (none passed) | 29.3 s | (none passed) | 7 | 80,327 | $0.0034 | $0.19 | 14 | (none passed) |

`reins do` numbers are from run 2. Step-by-step numbers are from run 1. The
github row's Jev columns are medians over all five run-2 attempts, since none
passed.

Totals:

- Step-by-step arm: 20 runs, $5.71 of Claude spend.
- `reins do`, run 2: 20 runs, 139 Jev calls, 1,203,404 input tokens, about
  $0.05 (about 8,660 tokens and about $0.00036 per call).
- Slowest step-by-step run: flights #3, 188 s, 65 turns, $1.14.

Run 1's `reins do` results, before the fix wave: flights 4/5, wikipedia 5/5,
cookies 5/5, github 0/5, with medians of 7.7 s, 2.8 s and 2.2 s. Run 1 did not
record token counts (reins did not print them yet). The step-by-step arm does
not depend on `reins do` code, so its run 1 numbers stand.

## What the cost columns mean

The Claude column is Claude Code's reported `total_cost_usd` for the whole
session: every snapshot read, every decision, every command. The Jev column is
only what Jev consumed. A calling agent that uses `reins do` still pays for its
own turn that issues the command, reads the result, and verifies the page. That
turn is not in the table. The ratio compares the model spend of doing the
browsing itself against the model spend of delegating it.

Jev pricing is from TypeSafe's own announcement
([Introducing System One models and Jev](https://typesafe.ai/blog/introducing-system-one-models-and-jev),
read 2026-09-27): input tokens at $0.042 per million, output tokens free. Token
counts are the API's own `usage.input_tokens`, summed per run; `reins do --json`
now reports them as `inputTokens`. The Jev cost column is tokens times $0.042
per million. TypeSafe notes it cannot prove the price is not subsidised.

## Failures

### github, `reins do` 0/5

Jev types the query, then chooses the "advanced search" link to set the language
filter. That page drops the typed query, so the final results are
`language:TypeScript` sorted by stars but without "browser automation" in them.

reins now has a SUBMIT_SEARCH operation (Enter in a search-like field), and Jev
uses it for the plain goal: "Search GitHub repositories for 'browser
automation'" finishes in 2.4 s at the correct URL. With the filter and sort in
the goal it picks the detour every time. The runs are deterministic: identical
runs in run 1 and run 2, five each. A prompt rule telling it to submit before
following links did not change the choice. That is a model routing limit today.

`reins do` reports `done` with the final URL, and the `next:` line says to
verify. This is why a calling agent must check the page before trusting `done`.
One run-2 github run ended `blocked` after 2 Jev calls ("Jev found nothing on
the page that can make progress").

### flights, step-by-step, 1 miss

Run 2: Claude finished after 26 turns with the page not passing the check. Its
own final line said the tab was showing the GitHub homepage instead of Google
Flights.

### flights, `reins do`, run 1

One run ended `stuck` at step 11 ("3 actions in a row changed nothing"). After
the fix wave, run 2 was 5/5.

## What it means

- For goals Jev can route, one `reins do` call replaces a 7 to 29 turn
  step-by-step session: 6.7 to 9.5 times faster wall-clock and roughly 90 to
  140 times cheaper in model spend on these tasks.
- The calling agent still pays for its own turn around `reins do` and for the
  verify step. The Claude column is a whole session; the Jev column is only Jev.
- Step-by-step is more robust on multi-constraint searches (github).
  `reins do` stops instead of flailing (`stuck`, `blocked`, `needs_text`,
  `risky_action`) and hands back a `next:` line, so the fallback is cheap.
- Privacy: `reins do` sends page text and control labels to TypeSafe (see the
  [`reins do` section of the security page](https://reins.tech/docs/security#reins-do)
  and [PRIVACY.md](../PRIVACY.md)). Step-by-step sends page content to Anthropic
  via Claude. Either way it is opt-in, with your own key.

## Method

Script: `packages/cli/scripts/bench-do.mjs`. Every run opens the task's start
URL in a fresh tab of the user's real Chrome (logged-in profile), waits 2 s for
the initial load outside the clock, then times the arm until it exits. The tab
is closed afterwards.

A run counts as passed only when an independent JavaScript check on the final
page returns true (`verified`) and the arm finished on its own (a timeout never
counts, even if the page ended up right). The checks, in plain words:

- **flights**: the URL is still on Google Flights and carries an encoded search
  (`tfs=`), the page text shows a price (any currency sign followed by a digit),
  and it mentions Zurich or ZRH, London, and Nov 20 in some form.
- **wikipedia**: the decoded pathname is exactly
  `/wiki/Gödel's_incompleteness_theorems`.
- **github**: the query string contains `browser`, the URL carries
  `language:TypeScript` (or `l=TypeScript`), the sort is `s=stars`, and the
  results list has at least one repository heading.
- **cookies**: the path is a forecast page (`/weather/<id>`), the title names
  Zurich, and no visible cookie or consent dialog is left. (From this machine's
  region BBC showed no consent banner at all, only a survey dialog, so that part
  of the check is a guard, not the proof.)

The arms:

- **`reins do`**: one call,
  `reins do "<goal>" --fill … --tab <id> --json`. Jev (TypeSafe System One,
  model jev-1.12) picks each action. The calling agent spends nothing while it
  runs.
- **Step-by-step**: `claude -p` (Claude Code 2.1.283, model claude-opus-5-5)
  driving the same tab with reins step commands only: snapshot, click, type,
  fill, select, press, hover, scroll, wait, text, screenshot. One Bash call per
  command, `--restricted` with an explicit allowlist, `reins do` denied, no
  navigation by URL, and a $2 cap per run. Its cost is Claude Code's reported
  `total_cost_usd`.

Runs: 5 per task per arm. Run 1 (2026-09-27, 00:58 UTC) covered all four tasks
and both arms. Run 2 (the same day, 04:32 UTC) re-ran the `reins do` arm after
a fix wave: the SUBMIT_SEARCH operation, a settle wait after submit, a stop on
stale retries, and token reporting.

Machine: the maintainer's laptop (macOS), reins 0.5.0, Node v24.18.0, on a
residential network in India (prices on Google Flights showed in ₹). TypeSafe
says its service runs on the US West Coast, so every Jev call crossed the
Pacific; the `reins do` times include that latency.

## Reproduce

```bash
node packages/cli/scripts/bench-do.mjs --runs 5
```

Needs a TypeSafe key (`reins key set typesafe`) and `claude` on PATH. It costs
money on both arms and opens tabs in your real browser. `--arm do --runs 1` is
the cheap first pass; `--dry` is a self-test with no browser and no spend.

## Every run

Time is wall-clock for the arm, in seconds. "step" is the number of actions
`reins do` took; "Jev calls" is the number of model calls the run made (more
than the step count, since not every call becomes an action).

### Run 1, `reins do` (before the fix wave)

| task | run | time | verified | status | step | Jev calls |
|---|---|---|---|---|---|---|
| flights | 1 | 7.7 s | yes | done | 13 | 15 |
| flights | 2 | 8.0 s | yes | done | 13 | 15 |
| flights | 3 | 5.6 s | no | stuck (3 actions in a row changed nothing) | 11 | 12 |
| flights | 4 | 7.6 s | yes | done | 13 | 15 |
| flights | 5 | 8.9 s | yes | done | 13 | 16 |
| wikipedia | 1 | 3.2 s | yes | done | 2 | 4 |
| wikipedia | 2 | 2.8 s | yes | done | 2 | 4 |
| wikipedia | 3 | 2.5 s | yes | done | 2 | 4 |
| wikipedia | 4 | 2.4 s | yes | done | 2 | 4 |
| wikipedia | 5 | 3.0 s | yes | done | 2 | 4 |
| github | 1 | 6.2 s | no | done | 6 | 8 |
| github | 2 | 6.0 s | no | done | 6 | 7 |
| github | 3 | 6.7 s | no | done | 6 | 7 |
| github | 4 | 6.2 s | no | done | 6 | 7 |
| github | 5 | 6.1 s | no | done | 6 | 7 |
| cookies | 1 | 2.2 s | yes | done | 3 | 4 |
| cookies | 2 | 2.2 s | yes | done | 3 | 4 |
| cookies | 3 | 2.8 s | yes | done | 3 | 4 |
| cookies | 4 | 2.1 s | yes | done | 3 | 4 |
| cookies | 5 | 2.1 s | yes | done | 3 | 4 |

### Run 1, step by step (Claude Code)

| task | run | time | verified | turns | cost |
|---|---|---|---|---|---|
| flights | 1 | 71.1 s | yes | 34 | $0.60 |
| flights | 2 | 59.9 s | no | 26 | $0.42 |
| flights | 3 | 188.3 s | yes | 65 | $1.14 |
| flights | 4 | 60.7 s | yes | 23 | $0.45 |
| flights | 5 | 92.1 s | yes | 29 | $0.57 |
| wikipedia | 1 | 15.4 s | yes | 6 | $0.13 |
| wikipedia | 2 | 21.8 s | yes | 7 | $0.14 |
| wikipedia | 3 | 17.6 s | yes | 7 | $0.14 |
| wikipedia | 4 | 18.3 s | yes | 7 | $0.14 |
| wikipedia | 5 | 21.3 s | yes | 9 | $0.15 |
| github | 1 | 28.2 s | yes | 16 | $0.19 |
| github | 2 | 27.6 s | yes | 14 | $0.19 |
| github | 3 | 30.1 s | yes | 13 | $0.19 |
| github | 4 | 29.3 s | yes | 18 | $0.21 |
| github | 5 | 29.8 s | yes | 13 | $0.19 |
| cookies | 1 | 17.3 s | yes | 8 | $0.17 |
| cookies | 2 | 18.4 s | yes | 7 | $0.16 |
| cookies | 3 | 16.5 s | yes | 7 | $0.15 |
| cookies | 4 | 35.3 s | yes | 15 | $0.22 |
| cookies | 5 | 16.2 s | yes | 7 | $0.15 |

### Run 2, `reins do` (after the fix wave)

Jev cost is input tokens times $0.042 per million.

| task | run | time | verified | status | step | Jev calls | input tokens | Jev cost |
|---|---|---|---|---|---|---|---|---|
| flights | 1 | 7.8 s | yes | done | 13 | 14 | 110,802 | $0.0047 |
| flights | 2 | 7.3 s | yes | done | 12 | 13 | 99,522 | $0.0042 |
| flights | 3 | 7.8 s | yes | done | 12 | 13 | 99,690 | $0.0042 |
| flights | 4 | 7.5 s | yes | done | 13 | 14 | 109,968 | $0.0046 |
| flights | 5 | 7.1 s | yes | done | 12 | 13 | 99,677 | $0.0042 |
| wikipedia | 1 | 2.7 s | yes | done | 2 | 4 | 35,319 | $0.0015 |
| wikipedia | 2 | 2.9 s | yes | done | 2 | 4 | 38,170 | $0.0016 |
| wikipedia | 3 | 2.9 s | yes | done | 2 | 4 | 38,170 | $0.0016 |
| wikipedia | 4 | 2.4 s | yes | done | 2 | 4 | 38,170 | $0.0016 |
| wikipedia | 5 | 2.7 s | yes | done | 2 | 4 | 38,170 | $0.0016 |
| github | 1 | 6.2 s | no | done | 6 | 7 | 79,635 | $0.0033 |
| github | 2 | 6.6 s | no | done | 6 | 8 | 88,922 | $0.0037 |
| github | 3 | 5.8 s | no | done | 6 | 7 | 80,327 | $0.0034 |
| github | 4 | 5.5 s | no | done | 7 | 8 | 107,274 | $0.0045 |
| github | 5 | 0.9 s | no | blocked (Jev found nothing on the page that can make progress) | 1 | 2 | 6,208 | $0.0003 |
| cookies | 1 | 2.4 s | yes | done | 3 | 4 | 26,156 | $0.0011 |
| cookies | 2 | 2.2 s | yes | done | 3 | 4 | 27,009 | $0.0011 |
| cookies | 3 | 2.6 s | yes | done | 3 | 4 | 26,754 | $0.0011 |
| cookies | 4 | 2.2 s | yes | done | 3 | 4 | 26,688 | $0.0011 |
| cookies | 5 | 2.3 s | yes | done | 3 | 4 | 26,773 | $0.0011 |
