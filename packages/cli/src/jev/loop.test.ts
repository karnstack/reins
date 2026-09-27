import type { JevAction, JevActParams, JevActResult, JevObservation } from "@reins/protocol";
import { describe, expect, it, vi } from "vitest";
import type { JevBody } from "./client.js";
import { type LoopDeps, runLoop } from "./loop.js";
import { fingerprint } from "./rules.js";
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

type Script = {
  op: string;
  target?: string;
  fill?: Record<string, string>;
  /** The operation head's probabilities (must include `op` as the max). */
  opProbs?: Record<string, number>;
};

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
      const given = s.opProbs;
      const total = given ? ids.reduce((sum, id) => sum + (given[id] ?? 0), 0) : 1;
      const probabilities =
        name === "operation" && given
          ? Object.fromEntries(ids.map((id) => [id, (given[id] ?? 0) / total]))
          : Object.fromEntries(
              ids.map((id) => [
                id,
                ids.length === 1 ? 1 : id === choice ? 0.9 : 0.1 / (ids.length - 1),
              ]),
            );
      out[name] = { choice, confidence: probabilities[choice] ?? 0.9, probabilities };
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
  it("carries the input tokens its asks consumed", async () => {
    let used = 0;
    const d = deps([page([button(1, "Go")])], [{ op: "CLICK", target: "1" }, { op: "DONE" }]);
    d.ask.mockImplementation(async (body) => {
      used += 1000;
      return scriptedJev([{ op: used === 1000 ? "CLICK" : "DONE", target: "1" }])(body);
    });
    const { result } = await runLoop({ ...d, inputTokens: () => used }, input());
    expect(result).toMatchObject({ status: "done", jevCalls: 2, inputTokens: 2000 });
  });

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

  it("submits a search field with Enter and records the step", async () => {
    const search: JevAction[] = field(3, "Search").map((a) =>
      a.kind === "fill" ? { ...a, value: "cats", submit: true } : a,
    );
    const d = deps(
      [page(search), page(search, { url: "https://x.com/results" })],
      [{ op: "SUBMIT_SEARCH", target: "1" }, { op: "DONE" }],
    );
    const { result, run } = await runLoop(d, input());
    expect(result.status).toBe("done");
    expect(d.act).toHaveBeenCalledWith({ op: "submit", node: 3, label: "Search" });
    expect(result.steps).toMatchObject([
      { n: 1, op: "submit", label: "Search", pageChanged: true },
    ]);
    expect(run.history).toMatchObject([{ op: "submit", label: "Search", pageChanged: true }]);
  });

  describe("unsure right after typing a search", () => {
    // github.com/search after typing the query: CLICK "advanced search"
    // 0.31–0.35, BLOCKED 0.29–0.32, SUBMIT_SEARCH 0.17–0.21 — a coin flip
    // between a detour and giving up, where a person presses Enter.
    const searchPage = (value: string, opts: Partial<JevObservation> = {}) =>
      page(
        [
          {
            id: "f3",
            kind: "fill",
            node: 3,
            role: "searchbox",
            label: "Search GitHub",
            value,
            submit: true,
          },
          button(7, "Advanced search"),
        ],
        opts,
      );
    const unsureClick = {
      op: "CLICK",
      target: "2",
      opProbs: {
        CLICK: 0.33,
        BLOCKED: 0.3,
        SUBMIT_SEARCH: 0.19,
        TYPE_TEXT: 0.1,
        WAIT: 0.05,
        DONE: 0.03,
      },
    };
    const results = { url: "https://x.com/search?q=cats", text: "3 results" };

    it("submits the field it just typed into instead of an unsure CLICK", async () => {
      const d = deps(
        [searchPage(""), searchPage("cats"), searchPage("cats", results)],
        [{ op: "TYPE_TEXT", target: "1", fill: { "1": "q" } }, unsureClick, { op: "DONE" }],
      );
      const run = newRun("search cats", "x.com", { q: "cats" }, [], 0);
      const { result } = await runLoop(d, input({ run }));
      expect(result.status).toBe("done");
      expect(d.act.mock.calls.map((c) => c[0].op)).toEqual(["type", "submit"]);
      expect(d.act).toHaveBeenLastCalledWith({ op: "submit", node: 3, label: "Search GitHub" });
      expect(result.steps[1]).toMatchObject({ n: 2, op: "submit", label: "Search GitHub" });
      expect(result.steps[1]?.confidence).toBeCloseTo(0.19);
    });

    it("submits instead of an unsure BLOCKED or WAIT", async () => {
      for (const op of ["BLOCKED", "WAIT"]) {
        const d = deps(
          [searchPage(""), searchPage("cats"), searchPage("cats", results)],
          [
            { op: "TYPE_TEXT", target: "1", fill: { "1": "q" } },
            { ...unsureClick, op, opProbs: { ...unsureClick.opProbs, CLICK: 0.29, [op]: 0.34 } },
            { op: "DONE" },
          ],
        );
        const run = newRun("search cats", "x.com", { q: "cats" }, [], 0);
        const { result } = await runLoop(d, input({ run }));
        expect(result.status).toBe("done");
        expect(d.act).toHaveBeenLastCalledWith({ op: "submit", node: 3, label: "Search GitHub" });
      }
    });

    it("the submit still goes through the risky-label stop", async () => {
      const send = (value: string): JevObservation =>
        page([
          {
            id: "f3",
            kind: "fill",
            node: 3,
            role: "searchbox",
            label: "Search and pay",
            value,
            submit: true,
          },
          button(7, "Advanced search"),
        ]);
      const d = deps(
        [send(""), send("cats")],
        [{ op: "TYPE_TEXT", target: "1", fill: { "1": "q" } }, unsureClick],
      );
      const run = newRun("search cats", "x.com", { q: "cats" }, [], 0);
      const { result } = await runLoop(d, input({ run }));
      expect(result).toMatchObject({
        status: "risky_action",
        pending: { op: "submit", label: "Search and pay" },
      });
      expect(d.act).toHaveBeenCalledTimes(1);
    });

    it("leaves a confident CLICK alone", async () => {
      const d = deps(
        [searchPage(""), searchPage("cats"), searchPage("cats", results)],
        [
          { op: "TYPE_TEXT", target: "1", fill: { "1": "q" } },
          {
            ...unsureClick,
            opProbs: {
              CLICK: 0.6,
              BLOCKED: 0.1,
              SUBMIT_SEARCH: 0.2,
              TYPE_TEXT: 0.05,
              WAIT: 0.03,
              DONE: 0.02,
            },
          },
          { op: "DONE" },
        ],
      );
      const run = newRun("search cats", "x.com", { q: "cats" }, [], 0);
      await runLoop(d, input({ run }));
      expect(d.act).toHaveBeenLastCalledWith({ op: "click", node: 7, label: "Advanced search" });
    });

    it("only fires when the last action was a type", async () => {
      const d = deps(
        [searchPage("cats"), searchPage("cats", { text: "scrolled" }), searchPage("cats", results)],
        [{ op: "WAIT" }, unsureClick, { op: "DONE" }],
      );
      await runLoop(d, input());
      expect(d.act).toHaveBeenLastCalledWith({ op: "click", node: 7, label: "Advanced search" });
    });

    it("only fires for the field that was typed into", async () => {
      // The last type went into another field: nothing to submit for it.
      const two = (value: string, opts: Partial<JevObservation> = {}) =>
        page(
          [
            {
              id: "f3",
              kind: "fill",
              node: 3,
              role: "searchbox",
              label: "Search GitHub",
              value: "old",
              submit: true,
            },
            { id: "f5", kind: "fill", node: 5, role: "textbox", label: "Name", value },
            button(7, "Advanced search"),
          ],
          opts,
        );
      const d = deps(
        [two(""), two("cats"), two("cats", results)],
        [{ op: "TYPE_TEXT", target: "2", fill: { "2": "q" } }, unsureClick, { op: "DONE" }],
      );
      const run = newRun("search cats", "x.com", { q: "cats" }, [], 0);
      await runLoop(d, input({ run }));
      expect(d.act).toHaveBeenLastCalledWith({ op: "click", node: 7, label: "Advanced search" });
    });

    it("does not fire when the field no longer holds a value", async () => {
      const d = deps(
        [searchPage(""), searchPage(""), searchPage("", results)],
        [{ op: "TYPE_TEXT", target: "1", fill: { "1": "q" } }, unsureClick, { op: "DONE" }],
      );
      const run = newRun("search cats", "x.com", { q: "cats" }, [], 0);
      await runLoop(d, input({ run }));
      expect(d.act).toHaveBeenLastCalledWith({ op: "click", node: 7, label: "Advanced search" });
    });

    it("never overrides DONE", async () => {
      const d = deps(
        [searchPage(""), searchPage("cats")],
        [
          { op: "TYPE_TEXT", target: "1", fill: { "1": "q" } },
          {
            op: "DONE",
            opProbs: {
              DONE: 0.3,
              CLICK: 0.29,
              BLOCKED: 0.2,
              SUBMIT_SEARCH: 0.11,
              TYPE_TEXT: 0.05,
              WAIT: 0.05,
            },
          },
        ],
      );
      const run = newRun("search cats", "x.com", { q: "cats" }, [], 0);
      const { result } = await runLoop(d, input({ run }));
      expect(result.status).toBe("done");
      expect(d.act).toHaveBeenCalledTimes(1);
    });
  });

  it("a submit runs the field's label through the risky-label stop", async () => {
    const send: JevAction[] = field(3, "Send message").map((a) =>
      a.kind === "fill" ? { ...a, value: "hi", submit: true } : a,
    );
    const d = deps([page(send)], [{ op: "SUBMIT_SEARCH", target: "1" }]);
    const { result } = await runLoop(d, input());
    expect(result).toMatchObject({
      status: "risky_action",
      pending: { op: "submit", label: "Send message" },
    });
    expect(d.act).not.toHaveBeenCalled();
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

  it("follows a click that opened a new tab", async () => {
    const d = {
      ...deps(
        [page([button(1, "Docs")]), page([], { url: "https://docs.x.com/", title: "Docs" })],
        [{ op: "CLICK", target: "1" }, { op: "DONE" }],
      ),
      retarget: vi.fn(),
    };
    d.act.mockResolvedValueOnce({ ok: true, openedTabId: 9 });
    const { result } = await runLoop(d, input());
    expect(result).toMatchObject({ status: "done", url: "https://docs.x.com/" });
    expect(d.retarget).toHaveBeenCalledWith(9);
    // Retargeted before the next read, so that read is of the new tab.
    expect(d.retarget.mock.invocationCallOrder[0]).toBeLessThan(
      d.observe.mock.invocationCallOrder[1] as number,
    );
    expect(result.steps[0]).toMatchObject({ op: "click", label: "Docs", openedTabId: 9 });
  });

  it("a dialog that beat a stale act is not that act's page change", async () => {
    const d = deps(
      [page([button(1, "Go")]), page([], { dialog: { type: "alert", message: "!" } })],
      [{ op: "CLICK", target: "1" }],
    );
    d.act.mockResolvedValueOnce({ stale: true, reason: "a dialog opened before the action" });
    const { result, run } = await runLoop(d, input());
    expect(result).toMatchObject({ status: "dialog", pageChanges: 0, steps: [] });
    expect(run.history[0]).toMatchObject({
      stale: "a dialog opened before the action",
      pageChanged: null,
    });
  });

  it("a trailing stale act does not switch the --continue breaker off", async () => {
    const run = { ...newRun("find flights", "x.com", {}, [], 0), step: 5 };
    const d = deps(
      [page([button(1, "Next")])],
      [{ op: "CLICK", target: "1" }, { op: "CLICK", target: "1" }, { op: "BLOCKED" }],
    );
    d.act
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ stale: true, reason: "gone" });
    const { result, run: after } = await runLoop(d, input({ run, continued: true }));
    expect(result.status).toBe("stuck");
    expect(result.reason).toContain("ran 1 action and none changed the page");
    expect(after.lockedFingerprint).toBeDefined();
  });

  it("the first read of a tab the click opened is never 'the tab was hidden'", async () => {
    const d = {
      ...deps(
        [
          page([button(1, "Docs")]),
          page([button(2, "x")], { url: "https://docs.x.com/", visible: false }),
        ],
        [{ op: "CLICK", target: "1" }, { op: "DONE" }],
      ),
      retarget: vi.fn(),
    };
    d.act.mockResolvedValueOnce({ ok: true, openedTabId: 9 });
    const { result } = await runLoop(d, input());
    expect(result.status).toBe("done");
  });

  it("three stale results in a row are stuck, without using a step", async () => {
    const d = deps(
      [page([button(1, "Next")])],
      [
        { op: "CLICK", target: "1" },
        { op: "CLICK", target: "1" },
        { op: "CLICK", target: "1" },
        { op: "DONE" },
      ],
    );
    d.act.mockResolvedValue({ stale: true, reason: "covered by div.overlay" });
    const { result, run } = await runLoop(d, input());
    expect(result).toMatchObject({
      status: "stuck",
      reason: 'couldn\'t act on "Next": covered by div.overlay',
      step: 0,
      steps: [],
    });
    expect(d.ask).toHaveBeenCalledTimes(3);
    expect(run.step).toBe(0);
    // The failures are remembered for Jev, but never count as no-progress actions.
    expect(run.history.map((h) => h.stale)).toEqual([
      "covered by div.overlay",
      "covered by div.overlay",
      "covered by div.overlay",
    ]);
    expect(run.history.every((h) => h.pageChanged === null)).toBe(true);
  });

  it("a stale result is told to Jev on the next ask, and a good act resets the count", async () => {
    const d = deps(
      [page([button(1, "Next"), button(2, "Go")])],
      [
        { op: "CLICK", target: "1" },
        { op: "CLICK", target: "1" },
        { op: "CLICK", target: "2" },
        { op: "CLICK", target: "1" },
        { op: "CLICK", target: "1" },
        { op: "DONE" },
      ],
    );
    d.act
      .mockResolvedValueOnce({ stale: true, reason: "the element is gone" })
      .mockResolvedValueOnce({ stale: true, reason: "the element is gone" })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ stale: true, reason: "covered" })
      .mockResolvedValueOnce({ stale: true, reason: "covered" });
    const { result } = await runLoop(d, input());
    expect(result.status).toBe("done");
    expect(result.step).toBe(1);
    const second = JSON.stringify(d.ask.mock.calls[1]?.[0]);
    expect(second).toContain('could not click \\"Next\\": the element is gone');
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

  it("a dialog observation is the click's outcome, but never the run's fingerprint", async () => {
    // The blocked page can't be read: the observation under a dialog has no
    // text or actions (and, from an older extension, no url/title). Treating
    // that as "the page" would poison the fingerprint; the dialog itself is
    // what the click did.
    const before = page([button(1, "Go")]);
    const d = deps(
      [
        before,
        {
          url: "",
          title: "",
          text: "",
          visible: true,
          actions: [],
          dialog: { type: "confirm", message: "Sure?" },
        },
      ],
      [{ op: "CLICK", target: "1" }],
    );
    const { result, run: after } = await runLoop(d, input());
    expect(result).toMatchObject({ status: "dialog", url: "https://x.com/a", title: "X", step: 1 });
    expect(result.steps[0]?.pageChanged).toBe(true);
    expect(after.history[0]?.pageChanged).toBe(true);
    expect(after.pageChanges).toBe(1);
    expect(after.lastFingerprint).toBe(fingerprint(before));
  });

  it("pins the start host on the first http page when the run began off-site", async () => {
    // about:blank / file:// / chrome-error:// have no host: without pinning,
    // left_site could never fire for such a run.
    const run = newRun("find flights", undefined, {}, [], 0);
    const d = deps(
      [
        page([button(1, "Go")], { url: "about:blank" }),
        page([button(1, "Go")], { url: "https://x.com/a", text: "landed" }),
        page([], { url: "https://evil.com/", text: "elsewhere" }),
      ],
      [
        { op: "CLICK", target: "1" },
        { op: "CLICK", target: "1" },
      ],
    );
    const { result, run: after } = await runLoop(d, input({ run }));
    expect(after.startHost).toBe("x.com");
    expect(result).toMatchObject({
      status: "left_site",
      reason: "the page moved to evil.com, outside x.com",
      step: 2,
    });
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

  it("a --timeout that fires during an action is budget, not interrupted", async () => {
    // handleDo aborts the loop's signal with a TimeoutError when --timeout
    // elapses; an act (or Jev call) that outlives it must report `budget`.
    const ctrl = new AbortController();
    let t = 0;
    const d = deps([page([button(1, "Next")])], [{ op: "CLICK", target: "1" }], {
      now: () => t,
    });
    d.act.mockImplementationOnce(async () => {
      t = 1500;
      ctrl.abort(new DOMException("timed out", "TimeoutError"));
      return { ok: true };
    });
    const { result } = await runLoop(d, input({ signal: ctrl.signal, timeoutMs: 1000 }));
    expect(result).toMatchObject({ status: "budget", reason: "timed out after 1s", step: 1 });
    expect(d.observe).toHaveBeenCalledTimes(1); // the first read only: no re-read after the cut
  });

  it("a Jev call cut short by --timeout is budget too", async () => {
    const ctrl = new AbortController();
    const d = deps([page([button(1, "Next")])], []);
    d.ask.mockImplementationOnce(async () => {
      ctrl.abort(new DOMException("timed out", "TimeoutError"));
      throw ctrl.signal.reason;
    });
    const { result } = await runLoop(d, input({ signal: ctrl.signal, timeoutMs: 5000 }));
    expect(result).toMatchObject({ status: "budget", reason: "timed out after 5s" });
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
    // The dialog is the click's outcome: progress, so no lock.
    expect(result.steps[0]?.pageChanged).toBe(true);
    expect(after.lockedFingerprint).toBeUndefined();
  });

  it("clicks that open dialogs count as progress, not toward stuck", async () => {
    // Each --continue: the dismissed dialog left the page as it was, the
    // click opens another one. Three in a row must not read as "nothing
    // changed": the dialog was the change.
    const same = page([button(1, "Ask")]);
    const blocked = page([], { dialog: { type: "confirm", message: "Sure?" } });
    let run = newRun("answer the question", "x.com", {}, [], 0);
    let continued = false;
    for (let i = 0; i < 3; i++) {
      const d = deps([same, blocked], [{ op: "CLICK", target: "1" }]);
      const out = await runLoop(d, input({ run, continued }));
      expect(out.result.status).toBe("dialog");
      expect(out.result.steps[0]?.pageChanged).toBe(true);
      run = out.run;
      continued = true;
    }
    expect(run.history.map((h) => h.pageChanged)).toEqual([true, true, true]);
    expect(run.pageChanges).toBe(3);
    expect(run.lastFingerprint).toBe(fingerprint(same));
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
