import type { JevAction, JevActParams, JevActResult, JevObservation } from "@reins/protocol";
import { describe, expect, it, vi } from "vitest";
import type { JevBody } from "./client.js";
import { type LoopDeps, runLoop } from "./loop.js";
import { newRun } from "./runs.js";

const WAIT: JevAction = { id: "wait", kind: "wait", label: "Wait for the page to update" };
const button = (node: number, label: string): JevAction => ({
  id: `b${node}`,
  kind: "click",
  node,
  role: "button",
  label,
});
const field = (node: number, label: string): JevAction[] => [
  { id: `f${node}`, kind: "fill", node, role: "textbox", label, value: "" },
  { id: `o${node}`, kind: "click", node, role: "textbox", label: `Open ${label}`, value: "" },
];
const page = (actions: JevAction[], opts: Partial<JevObservation> = {}): JevObservation => ({
  url: "https://x.com/a",
  title: "X",
  text: "page",
  visible: true,
  actions: [...actions, WAIT],
  ...opts,
});

type Script = { op: string; target?: string; fill?: Record<string, string> };

/** Fake Jev: answers each request from the next script entry, filling
 *  speculative heads with their first option. */
function scriptedJev(script: Script[]) {
  return vi.fn(async (body: JevBody) => {
    const s = script.shift();
    if (!s) throw new Error("script exhausted");
    const out: Record<string, unknown> = {};
    for (const [name, q] of Object.entries(body.questions)) {
      const ids = Object.keys((q as { criteria?: Record<string, unknown> }).criteria ?? {});
      const choice =
        name === "operation"
          ? s.op
          : name.endsWith("_target")
            ? s.target && ids.includes(s.target)
              ? s.target
              : (ids[0] as string)
            : (s.fill?.[name.slice("fill_for_".length)] ?? "NONE");
      out[name] = {
        choice,
        confidence: 0.9,
        probabilities: Object.fromEntries(
          ids.map((id) => [
            id,
            ids.length === 1 ? 1 : id === choice ? 0.9 : 0.1 / (ids.length - 1),
          ]),
        ),
      };
    }
    return out;
  });
}

/** Pages served in order; the last one repeats. */
function deps(pages: JevObservation[], script: Script[], opts: { now?: () => number } = {}) {
  const queue = [...pages];
  const observe = vi.fn(async () =>
    queue.length > 1 ? (queue.shift() as JevObservation) : (queue[0] as JevObservation),
  );
  const act = vi.fn<(p: Omit<JevActParams, "browserId" | "tabId">) => Promise<JevActResult>>(
    async () => ({ ok: true }),
  );
  return { observe, act, ask: scriptedJev(script), now: opts.now ?? (() => 0) } satisfies LoopDeps;
}

const input = (over: Partial<Parameters<typeof runLoop>[1]> = {}) => ({
  run: newRun("find flights", "x.com", {}, [], 0),
  maxSteps: 30,
  timeoutMs: 60_000,
  signal: new AbortController().signal,
  continued: false,
  ...over,
});

describe("runLoop", () => {
  it("finishes when Jev says DONE", async () => {
    const d = deps([page([])], [{ op: "DONE" }]);
    const { result } = await runLoop(d, input());
    expect(result).toMatchObject({ status: "done", jevCalls: 1, steps: [] });
  });

  it("clicks, sees the page change, then finishes", async () => {
    const d = deps(
      [page([button(1, "Search")]), page([], { text: "results" })],
      [{ op: "CLICK", target: "1" }, { op: "DONE" }],
    );
    const { result } = await runLoop(d, input());
    expect(d.act).toHaveBeenCalledWith({ op: "click", node: 1, label: "Search" });
    expect(result.status).toBe("done");
    expect(result.steps).toEqual([
      expect.objectContaining({ n: 1, op: "click", label: "Search", pageChanged: true }),
    ]);
  });

  it("stops before a risky click and names it", async () => {
    const d = deps([page([button(1, "Pay now")])], [{ op: "CLICK", target: "1" }]);
    const { result } = await runLoop(d, input());
    expect(result).toMatchObject({
      status: "risky_action",
      pending: { op: "click", label: "Pay now" },
    });
    expect(d.act).not.toHaveBeenCalled();
  });

  it("--confirm lets that click through exactly once", async () => {
    const run = newRun("find flights", "x.com", {}, ["Pay now"], 0);
    const d = deps(
      [page([button(1, "Pay now")]), page([button(1, "Pay now")], { text: "2" })],
      [
        { op: "CLICK", target: "1" },
        { op: "CLICK", target: "1" },
      ],
    );
    const { result, run: after } = await runLoop(d, input({ run }));
    expect(d.act).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("risky_action");
    expect(after.confirms).toEqual([]);
  });

  it("types the fill Jev matched to that field", async () => {
    const run = newRun("Zurich to London", "x.com", { from: "Zurich", to: "London" }, [], 0);
    const d = deps(
      [page([...field(3, "Where from?"), ...field(5, "Where to?")]), page([], { text: "2" })],
      [{ op: "TYPE_TEXT", target: "2", fill: { "1": "from", "2": "to" } }, { op: "DONE" }],
    );
    const { result } = await runLoop(d, input({ run }));
    expect(d.act).toHaveBeenCalledWith({ op: "type", node: 5, text: "London", label: "Where to?" });
    expect(result.steps[0]).toMatchObject({ op: "type", fill: "to" });
  });

  it("stops for text it wasn't given", async () => {
    const d = deps([page(field(3, "Passenger name"))], [{ op: "TYPE_TEXT", target: "1" }]);
    const { result } = await runLoop(d, input());
    expect(result).toMatchObject({
      status: "needs_text",
      reason: 'field "Passenger name" has no --fill',
      pending: { op: "type", label: "Passenger name" },
    });
  });

  it("says when none of the fills matched the field", async () => {
    const run = newRun("book it", "x.com", { from: "Zurich" }, [], 0);
    const d = deps([page(field(3, "Passenger name"))], [{ op: "TYPE_TEXT", target: "1" }]);
    const { result } = await runLoop(d, input({ run }));
    expect(result).toMatchObject({
      status: "needs_text",
      reason: 'field "Passenger name" matched none of your --fill values',
    });
  });

  it("asks a second time for the fill of a field beyond the first 8", async () => {
    const run = newRun("book it", "x.com", { name: "Bob" }, [], 0);
    const fields = Array.from({ length: 9 }, (_, i) => field(i + 1, `Field ${i + 1}`)).flat();
    const d = deps(
      [page(fields), page([], { text: "2" })],
      [{ op: "TYPE_TEXT", target: "9" }, { op: "-", fill: { "9": "name" } }, { op: "DONE" }],
    );
    const { result } = await runLoop(d, input({ run }));
    expect(d.ask).toHaveBeenCalledTimes(3);
    expect(Object.keys(d.ask.mock.calls[1]?.[0].questions ?? {})).toEqual(["fill_for_9"]);
    expect(d.act).toHaveBeenCalledWith({ op: "type", node: 9, text: "Bob", label: "Field 9" });
    expect(result).toMatchObject({ status: "done", jevCalls: 3 });
    expect(result.steps[0]).toMatchObject({ op: "type", fill: "name" });
  });

  it("stops at the Jev-call cap", async () => {
    const d = deps(
      [page([button(1, "Next")])],
      [
        { op: "CLICK", target: "1" },
        { op: "CLICK", target: "1" },
        { op: "CLICK", target: "1" },
      ],
    );
    d.act.mockResolvedValue({ stale: true, reason: "covered" });
    const { result } = await runLoop(d, input({ maxSteps: 1 }));
    expect(result).toMatchObject({ status: "budget", reason: "reached 2 Jev calls", step: 0 });
    expect(d.ask).toHaveBeenCalledTimes(2);
  });

  it("never mutates the run it was given", async () => {
    const run = newRun("find flights", "x.com", {}, ["Pay now"], 0);
    const d = deps(
      [page([button(1, "Pay now")]), page([], { text: "2" })],
      [{ op: "CLICK", target: "1" }, { op: "DONE" }],
    );
    const { run: after } = await runLoop(d, input({ run }));
    expect(after.step).toBe(1);
    expect(run).toEqual(newRun("find flights", "x.com", {}, ["Pay now"], 0));
  });

  it("re-reads a stale target without using a step", async () => {
    const d = deps([page([button(1, "Search")])], [{ op: "CLICK", target: "1" }, { op: "DONE" }]);
    d.act.mockResolvedValueOnce({ stale: true, reason: "the element is gone" });
    const { result } = await runLoop(d, input());
    expect(result.status).toBe("done");
    expect(result.step).toBe(0);
    expect(d.observe).toHaveBeenCalledTimes(2);
  });

  it("calls it stuck after 3 actions that change nothing", async () => {
    const d = deps(
      [page([button(1, "Next")])],
      [
        { op: "CLICK", target: "1" },
        { op: "CLICK", target: "1" },
        { op: "CLICK", target: "1" },
      ],
    );
    const { result } = await runLoop(d, input());
    expect(result.status).toBe("stuck");
    expect(result.step).toBe(3);
  });

  it("stops when the page moves to another site", async () => {
    const d = deps(
      [page([button(1, "Go")]), page([], { url: "https://evil.com/" })],
      [{ op: "CLICK", target: "1" }],
    );
    expect((await runLoop(d, input())).result.status).toBe("left_site");
  });

  it("stops on an open JS dialog", async () => {
    const d = deps([page([], { dialog: { type: "confirm", message: "Leave?" } })], []);
    expect((await runLoop(d, input())).result).toMatchObject({ status: "dialog" });
  });

  it("stops when the tab gets hidden mid-run", async () => {
    const d = deps(
      [page([button(1, "Go")]), page([], { visible: false, text: "2" })],
      [{ op: "CLICK", target: "1" }],
    );
    expect((await runLoop(d, input())).result.status).toBe("interrupted");
  });

  it("stops at max steps", async () => {
    const pages = [1, 2, 3, 4].map((i) => page([button(1, "Next")], { text: `p${i}` }));
    const d = deps(
      pages,
      Array.from({ length: 5 }, () => ({ op: "CLICK", target: "1" })),
    );
    const { result } = await runLoop(d, input({ maxSteps: 2 }));
    expect(result).toMatchObject({ status: "budget", step: 2, maxSteps: 2 });
  });

  it("stops at the timeout", async () => {
    let t = 0;
    const d = deps(
      [page([button(1, "Next")])],
      [
        { op: "CLICK", target: "1" },
        { op: "CLICK", target: "1" },
      ],
      { now: () => (t += 400) },
    );
    const { result } = await runLoop(d, input({ timeoutMs: 1000 }));
    expect(result.status).toBe("budget");
    expect(result.reason).toContain("timed out");
  });

  it("stops before acting once aborted", async () => {
    const ctrl = new AbortController();
    const d = deps([page([button(1, "Next")])], [{ op: "CLICK", target: "1" }]);
    d.ask.mockImplementationOnce(async (body) => {
      ctrl.abort(new Error("daemon restarting"));
      return scriptedJev([{ op: "CLICK", target: "1" }])(body);
    });
    const { result } = await runLoop(d, input({ signal: ctrl.signal }));
    expect(result).toMatchObject({ status: "interrupted", reason: "daemon restarting" });
    expect(d.act).not.toHaveBeenCalled();
  });

  it("a --continue that changes nothing is stuck, and locks the next --continue", async () => {
    const run = { ...newRun("find flights", "x.com", {}, [], 0), step: 5 };
    const d = deps([page([button(1, "Next")])], [{ op: "CLICK", target: "1" }, { op: "BLOCKED" }]);
    const first = await runLoop(d, input({ run, continued: true }));
    expect(first.result.status).toBe("stuck");
    expect(first.run.lockedFingerprint).toBeDefined();
    const again = deps([page([button(1, "Next")])], []);
    const second = await runLoop(again, input({ run: first.run, continued: true }));
    expect(second.result.status).toBe("stuck");
    expect(again.ask).not.toHaveBeenCalled();
  });

  it("a --continue that opens a dialog reports the dialog, not stuck", async () => {
    const run = { ...newRun("find flights", "x.com", {}, [], 0), step: 5 };
    const d = deps(
      [
        page([button(1, "Go")]),
        page([button(1, "Go")], { dialog: { type: "confirm", message: "Sure?" }, title: "Y" }),
      ],
      [{ op: "CLICK", target: "1" }],
    );
    const { result, run: after } = await runLoop(d, input({ run, continued: true }));
    expect(result).toMatchObject({ status: "dialog", title: "Y", step: 6 });
    expect(result.steps[0]?.pageChanged).toBe(false);
    expect(after.lockedFingerprint).toBeUndefined();
  });

  it("a --continue that is aborted after acting is interrupted, not stuck", async () => {
    const ctrl = new AbortController();
    const run = { ...newRun("find flights", "x.com", {}, [], 0), step: 5 };
    const d = deps([page([button(1, "Go")])], [{ op: "CLICK", target: "1" }]);
    d.act.mockImplementationOnce(async () => {
      ctrl.abort(new Error("daemon restarting"));
      return { ok: true };
    });
    const { result, run: after } = await runLoop(
      d,
      input({ run, continued: true, signal: ctrl.signal }),
    );
    expect(result).toMatchObject({ status: "interrupted", reason: "daemon restarting", step: 6 });
    expect(after.lockedFingerprint).toBeUndefined();
  });

  it("a --continue that times out mid-action is budget, not stuck", async () => {
    let t = 0;
    const run = { ...newRun("find flights", "x.com", {}, [], 0), step: 5 };
    const d = deps([page([button(1, "Go")])], [{ op: "CLICK", target: "1" }], {
      now: () => (t += 400),
    });
    const { result, run: after } = await runLoop(
      d,
      input({ run, continued: true, timeoutMs: 1000 }),
    );
    expect(result.status).toBe("budget");
    expect(result.reason).toContain("timed out");
    expect(after.lockedFingerprint).toBeUndefined();
  });

  it("continues step numbering and grants a fresh budget", async () => {
    const run = { ...newRun("find flights", "x.com", {}, [], 0), step: 30 };
    const d = deps(
      [page([button(1, "Next")]), page([], { text: "2" })],
      [{ op: "CLICK", target: "1" }, { op: "DONE" }],
    );
    const { result } = await runLoop(d, input({ run, continued: true, maxSteps: 30 }));
    expect(result).toMatchObject({ status: "done", step: 31, maxSteps: 60 });
    expect(result.steps[0]?.n).toBe(31);
  });

  it("returns errors as a result, with steps so far", async () => {
    const d = deps(
      [page([button(1, "Go")]), page([], { text: "2" })],
      [{ op: "CLICK", target: "1" }],
    );
    const { result } = await runLoop(d, input());
    expect(result.status).toBe("error");
    expect(result.reason).toContain("script exhausted");
    expect(result.steps).toHaveLength(1);
  });
});
