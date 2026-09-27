import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { fillName, formatDoResult, nextCommand, shellQuote, tokens } from "./format.js";
import type { DoResult } from "./types.js";

const base: DoResult = {
  status: "done",
  steps: [
    { n: 1, op: "click", label: "Where from?", confidence: 0.9, ms: 120, pageChanged: true },
    {
      n: 2,
      op: "type",
      label: "Where from?",
      fill: "from",
      confidence: 0.9,
      ms: 80,
      pageChanged: true,
    },
  ],
  url: "https://x.com/r",
  title: "Results",
  elapsedMs: 7200,
  jevCalls: 17,
  inputTokens: 21_400,
  step: 2,
  maxSteps: 30,
  pageChanges: 2,
};

describe("tokens", () => {
  it.each([
    [0, "0 tokens"],
    [812, "812 tokens"],
    [1000, "1k tokens"],
    [2840, "2.8k tokens"],
    [9940, "9.9k tokens"],
    [9990, "10k tokens"],
    [21_400, "21k tokens"],
    [999_400, "999k tokens"],
    [1_250_000, "1.3M tokens"],
    [12_000_000, "12M tokens"],
  ])("%d → %s", (n, text) => {
    expect(tokens(n)).toBe(text);
  });
});

describe("formatDoResult", () => {
  it("prints a finished run with its steps and the verify hint", () => {
    const text = formatDoResult({ ...base, next: nextCommand(base, { goal: "g" }) });
    expect(text).toBe(
      [
        "done in 7.2s · 2 steps · 17 jev calls · 21k tokens",
        '  1 click  "Where from?"',
        '  2 type   "Where from?" ← from',
        'now: https://x.com/r — "Results"',
        "next: reins snapshot   # verify before trusting DONE",
      ].join("\n"),
    );
  });

  it("shows the DONE self-check's probability when the run had one", () => {
    expect(formatDoResult({ ...base, doneConfidence: 0.91 }).split("\n")[0]).toBe(
      "done in 7.2s · 2 steps · 17 jev calls · 21k tokens · self-check 0.91",
    );
  });

  it("says so on the done line when the self-check is unsure, and hardens the verify hint", () => {
    const unsure = { ...base, doneConfidence: 0.34, elapsedMs: 4100 };
    expect(formatDoResult({ ...unsure, next: nextCommand(unsure, { goal: "g" }) })).toBe(
      [
        "done (unsure: self-check 0.34) in 4.1s · 2 steps · 17 jev calls · 21k tokens",
        '  1 click  "Where from?"',
        '  2 type   "Where from?" ← from',
        'now: https://x.com/r — "Results"',
        "next: reins snapshot   # self-check says the goal may not be met — verify",
      ].join("\n"),
    );
    // Exactly 0.5 is not unsure.
    expect(formatDoResult({ ...base, doneConfidence: 0.5 }).split("\n")[0]).toBe(
      "done in 7.2s · 2 steps · 17 jev calls · 21k tokens · self-check 0.50",
    );
  });

  it("says 1 step and 1 jev call in the singular", () => {
    const one = { ...base, steps: base.steps.slice(0, 1), jevCalls: 1 };
    expect(formatDoResult(one).split("\n")[0]).toBe(
      "done in 7.2s · 1 step · 1 jev call · 21k tokens",
    );
  });

  it("notes a step that opened a new tab", () => {
    const step = { ...(base.steps[0] as DoResult["steps"][number]), openedTabId: 9 };
    expect(formatDoResult({ ...base, steps: [step] })).toContain(
      '  1 click  "Where from?" → new tab 9',
    );
  });

  it("shows the self-check on a stuck line when the run had one", () => {
    const r: DoResult = {
      ...base,
      status: "stuck",
      reason: "3 actions in a row changed nothing",
      doneConfidence: 0.31,
    };
    expect(formatDoResult(r).split("\n")[0]).toBe(
      "stuck: 3 actions in a row changed nothing (self-check 0.31)",
    );
    expect(formatDoResult({ ...r, doneConfidence: undefined }).split("\n")[0]).toBe(
      "stuck: 3 actions in a row changed nothing",
    );
  });

  it("prints a stop with progress and the next command", () => {
    const r: DoResult = {
      ...base,
      status: "risky_action",
      reason: 'next click is "Pay now" (its label says "pay")',
      pending: { op: "click", label: "Pay now" },
      steps: [],
      step: 9,
      pageChanges: 8,
      elapsedMs: 4100,
    };
    const text = formatDoResult({ ...r, next: nextCommand(r, { goal: "g", tabId: 7 }) });
    expect(text).toContain('risky_action: next click is "Pay now"');
    expect(text).toContain("stopped at step 9/30 · page changed 8× · 4.1s · 21k tokens");
    expect(text).toContain("next: reins do --continue --confirm 'Pay now' --tab 7");
  });

  it("prints an error without a progress line when no steps ran", () => {
    const text = formatDoResult({ ...base, status: "error", reason: "boom", steps: [] });
    expect(text).toBe("error: boom");
  });

  it("prints an error with progress when steps ran", () => {
    const text = formatDoResult({ ...base, status: "error", reason: "boom" });
    expect(text).toContain("stopped at step 2/30 · page changed 2× · 7.2s");
  });
});

describe("nextCommand", () => {
  const r = (status: DoResult["status"], extra: Partial<DoResult> = {}) => ({
    ...base,
    status,
    ...extra,
  });
  it.each([
    [
      "needs_text",
      r("needs_text", { pending: { op: "type", label: "Passenger name" } }),
      'reins do --continue --fill passenger_name="…"',
    ],
    ["budget", r("budget"), "reins do --continue"],
    ["stuck", r("stuck"), "switch to manual (reins snapshot → click/type)"],
    ["blocked", r("blocked"), "switch to manual (reins snapshot → click/type)"],
    ["dialog", r("dialog"), "reins dialog --accept   # or --dismiss; then: reins do --continue"],
    ["left_site", r("left_site"), "reins do 'g'   # from this page, if the new site is expected"],
    ["interrupted", r("interrupted"), "reins do --continue"],
  ])("%s", (_status, result, expected) => {
    expect(nextCommand(result, { goal: "g" })).toBe(expected);
  });

  it("gives no next command for errors", () => {
    expect(nextCommand(r("error"), { goal: "g" })).toBeUndefined();
  });

  it("routes both halves of the dialog line", () => {
    expect(nextCommand(r("dialog"), { goal: "g", tabId: 7 })).toBe(
      "reins dialog --accept --tab 7   # or --dismiss; then: reins do --continue --tab 7",
    );
  });

  it("appends --tab and --browser to the route when given", () => {
    expect(nextCommand(r("budget"), { goal: "g", tabId: 7, browserId: "b1" })).toBe(
      "reins do --continue --tab 7 --browser 'b1'",
    );
  });

  it("single-quotes the --browser id like every other user-supplied value", () => {
    const cmd = nextCommand(r("budget"), { goal: "g", browserId: "b$1 'x'" });
    expect(cmd).toBe(`reins do --continue --browser 'b$1 '\\''x'\\'''`);
  });

  it("routes the verify hint after done to the same tab and browser", () => {
    expect(nextCommand(r("done"), { goal: "g" })).toBe(
      "reins snapshot   # verify before trusting DONE",
    );
    expect(nextCommand(r("done"), { goal: "g", tabId: 7, browserId: "b1" })).toBe(
      "reins snapshot --tab 7 --browser 'b1'   # verify before trusting DONE",
    );
    expect(nextCommand({ ...r("done"), doneConfidence: 0.34 }, { goal: "g", tabId: 7 })).toBe(
      "reins snapshot --tab 7   # self-check says the goal may not be met — verify",
    );
  });

  it("single-quotes a page-controlled confirm label so nothing expands", () => {
    const label = "Pay $5 for Bob's `x` $(echo x)";
    const cmd = nextCommand(r("risky_action", { pending: { op: "click", label } }), { goal: "g" });
    expect(cmd).toBe("reins do --continue --confirm 'Pay $5 for Bob'\\''s `x` $(echo x)'");
  });

  it("single-quotes the goal for left_site", () => {
    expect(nextCommand(r("left_site"), { goal: "book $10 'cheap' seat" })).toBe(
      "reins do 'book $10 '\\''cheap'\\'' seat'   # from this page, if the new site is expected",
    );
  });
});

describe("shellQuote", () => {
  it("round-trips through a real POSIX shell unchanged", () => {
    const label = "Pay $5 for Bob's `x` $(echo x)";
    const out = execFileSync("sh", ["-c", `printf %s ${shellQuote(label)}`], { encoding: "utf8" });
    expect(out).toBe(label);
  });

  it("quotes the empty string", () => {
    expect(shellQuote("")).toBe("''");
  });
});

describe("fillName", () => {
  it("names a fill after its field", () => {
    expect(fillName("Where to?")).toBe("where_to");
    expect(fillName("???")).toBe("value");
  });

  it("caps the name at 24 characters", () => {
    const name = fillName("Primary passenger full legal name as on passport");
    expect(name).toBe("primary_passenger_full_l");
    expect(name).toHaveLength(24);
  });
});
