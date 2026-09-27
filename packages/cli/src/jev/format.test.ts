import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { fillName, formatDoResult, nextCommand, shellQuote } from "./format.js";
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
  step: 2,
  maxSteps: 30,
  pageChanges: 2,
};

describe("formatDoResult", () => {
  it("prints a finished run with its steps and the verify hint", () => {
    const text = formatDoResult({ ...base, next: nextCommand(base, { goal: "g" }) });
    expect(text).toBe(
      [
        "done in 7.2s · 2 steps · 17 jev calls",
        '  1 click  "Where from?"',
        '  2 type   "Where from?" ← from',
        'now: https://x.com/r — "Results"',
        "next: reins snapshot   # verify before trusting DONE",
      ].join("\n"),
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
    expect(text).toContain("stopped at step 9/30 · page changed 8× · 4.1s");
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
      "reins do --continue --tab 7 --browser b1",
    );
  });

  it("routes the verify hint after done to the same tab and browser", () => {
    expect(nextCommand(r("done"), { goal: "g" })).toBe(
      "reins snapshot   # verify before trusting DONE",
    );
    expect(nextCommand(r("done"), { goal: "g", tabId: 7, browserId: "b1" })).toBe(
      "reins snapshot --tab 7 --browser b1   # verify before trusting DONE",
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
