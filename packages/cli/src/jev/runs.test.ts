import { describe, expect, it } from "vitest";
import { newRun, RunStore } from "./runs.js";

describe("RunStore", () => {
  it("keys by browser and tab", () => {
    expect(RunStore.key("b1", 5)).toBe("b1:5");
    expect(RunStore.key("b2", 5)).not.toBe(RunStore.key("b1", 5));
  });

  it("stores and returns a run until it expires", () => {
    let t = 0;
    const runs = new RunStore({ ttlMs: 1000, now: () => t });
    runs.set("b1:5", newRun("goal", "x.com", {}, [], t));
    t = 999;
    expect(runs.get("b1:5")?.goal).toBe("goal");
    t = 2100;
    expect(runs.get("b1:5")).toBeUndefined();
  });

  it("allows one active run per tab", () => {
    const runs = new RunStore();
    expect(runs.tryBegin("b1:5")).toBe(true);
    expect(runs.tryBegin("b1:5")).toBe(false);
    expect(runs.tryBegin("b1:6")).toBe(true);
    runs.end("b1:5");
    expect(runs.tryBegin("b1:5")).toBe(true);
  });
});
