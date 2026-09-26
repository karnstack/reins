import { describe, expect, it } from "vitest";
import { fillName, formatDoResult, nextCommand } from "./format.js";
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
    expect(text).toContain('next: reins do --continue --confirm "Pay now" --tab 7');
  });

  it("prints an error without a progress line when no steps ran", () => {
    const text = formatDoResult({ ...base, status: "error", reason: "boom", steps: [] });
    expect(text).toBe("error: boom");
  });

  it("prints an error with progress when steps ran", () => {
    const text = formatDoResult({ ...base, status: "error", reason: "boom" });
    expect(text).toContain("stopped at step 2/30 · page changed 2× · 7.2s");
  });

  it("appends --browser to the route when given", () => {
    const r: DoResult = { ...base, status: "budget" };
    expect(nextCommand(r, { goal: "g", tabId: 7, browserId: "b1" })).toBe(
      "reins do --continue --tab 7 --browser b1",
    );
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
      r("needs_text", { pending: { op: "type", label: "Passenger name" } }),
      'reins do --continue --fill passenger_name="…"',
    ],
    [r("budget"), "reins do --continue"],
    [r("stuck"), "switch to manual (reins snapshot → click/type)"],
    [r("blocked"), "switch to manual (reins snapshot → click/type)"],
    [r("dialog"), "reins dialog --accept (or --dismiss), then reins do --continue"],
    [r("left_site"), 'reins do "g"   # from this page, if the new site is expected'],
    [r("interrupted"), "reins do --continue"],
  ])("%#", (result, expected) => {
    expect(nextCommand(result, { goal: "g" })).toBe(expected);
  });

  it("gives no next command for errors", () => {
    expect(nextCommand(r("error"), { goal: "g" })).toBeUndefined();
  });

  it("names a fill after its field", () => {
    expect(fillName("Where to?")).toBe("where_to");
    expect(fillName("???")).toBe("value");
  });
});
