import type { JevAction, JevObservation } from "@reins/protocol";
import { describe, expect, it } from "vitest";
import { JevError } from "./client.js";
import {
  actionSpace,
  buildRequest,
  doneCheckRequest,
  interpret,
  interpretDoneCheck,
  MAX_FILL_HEADS,
} from "./space.js";

const field = (node: number, label: string, value = ""): JevAction[] => [
  { id: `f${node}`, kind: "fill", node, role: "textbox", label, value },
  { id: `o${node}`, kind: "click", node, role: "textbox", label: `Open ${label}`, value },
];
const button = (node: number, label: string): JevAction => ({
  id: `b${node}`,
  kind: "click",
  node,
  role: "button",
  label,
  value: "",
});
const page = (actions: JevAction[]): JevObservation => ({
  url: "https://x.com/",
  title: "X",
  text: "t",
  visible: true,
  actions: [...actions, { id: "wait", kind: "wait", label: "Wait for the page to update" }],
});
const answer = (choice: string, ids: string[]) => ({
  type: "choice",
  choice,
  confidence: 0.9,
  probabilities: Object.fromEntries(
    ids.map((id) => [id, ids.length === 1 ? 1 : id === choice ? 0.9 : 0.1 / (ids.length - 1)]),
  ),
});

describe("actionSpace", () => {
  it("gives each element one index, with every operation it supports", () => {
    const s = actionSpace([...field(3, "Where from?"), button(4, "Search")]);
    expect(s.elements.map((e) => [e.index, e.label, e.operations])).toEqual([
      ["1", "Where from?", ["TYPE_TEXT", "CLICK"]],
      ["2", "Search", ["CLICK"]],
    ]);
    expect(Object.keys(s.targets.TYPE_TEXT ?? {})).toEqual(["1"]);
    expect(Object.keys(s.targets.CLICK ?? {})).toEqual(["1", "2"]);
  });

  it("numbers native select options under their element", () => {
    const s = actionSpace([
      {
        id: "s1",
        kind: "select",
        node: 9,
        role: "combobox",
        label: "Cabin → Business",
        value: "biz",
        current_value: "Economy",
      },
      {
        id: "s2",
        kind: "select",
        node: 9,
        role: "combobox",
        label: "Cabin → First",
        value: "first",
        current_value: "Economy",
      },
    ]);
    expect(Object.keys(s.targets.SELECT ?? {})).toEqual(["1:1", "1:2"]);
    expect(s.elements[0]?.label).toBe("Cabin");
  });

  it("turns scroll/wait into controls", () => {
    const s = actionSpace(page([]).actions);
    expect(Object.keys(s.controls)).toEqual(["WAIT"]);
  });
});

describe("buildRequest", () => {
  it("asks for an operation and one target per offered operation", () => {
    const plan = buildRequest(
      page([...field(3, "Where from?"), button(4, "Search")]),
      "goal",
      [],
      {},
    );
    expect(Object.keys(plan.body.questions).sort()).toEqual([
      "click_target",
      "operation",
      "type_text_target",
    ]);
    expect(plan.operations).toEqual(
      expect.arrayContaining(["CLICK", "TYPE_TEXT", "WAIT", "DONE", "BLOCKED"]),
    );
    expect(plan.fillHeads).toEqual([]);
  });

  it("asks one fill question per text field, capped", () => {
    const fields = Array.from({ length: 10 }, (_, i) => field(i + 1, `Field ${i + 1}`)).flat();
    const plan = buildRequest(page(fields), "goal", [], { from: "Zurich", to: "London" });
    expect(plan.fillHeads).toHaveLength(MAX_FILL_HEADS);
    const q = plan.body.questions.fill_for_1 as { criteria: Record<string, unknown> };
    expect(Object.keys(q.criteria)).toEqual(["from", "to", "NONE"]);
  });
});

describe("doneCheckRequest", () => {
  it("asks one yes/no question on the same state buildRequest sends, with the goal", () => {
    const obs = page([button(1, "Apply"), ...field(2, "Search", "cats")]);
    const history = [{ op: "type" as const, label: "Search", fill: "q", pageChanged: true }];
    const req = doneCheckRequest(obs, "filter by cats", history, { q: "cats" });
    expect(req.state).toEqual(
      buildRequest(obs, "filter by cats", history, { q: "cats" }).body.state,
    );
    expect(Object.keys(req.questions)).toEqual(["satisfied"]);
    expect(req.questions.satisfied).toMatchObject({
      type: "noul",
      instructions: { goal: "filter by cats" },
      criteria: { true: expect.any(String), false: expect.any(String) },
    });
  });

  it("reads the probability and refuses anything else", () => {
    expect(interpretDoneCheck({ satisfied: { type: "noul", noul: 0.42 } })).toBe(0.42);
    for (const bad of [
      {},
      { satisfied: {} },
      { satisfied: { noul: "0.4" } },
      { satisfied: { noul: 2 } },
    ])
      expect(() => interpretDoneCheck(bad)).toThrow(JevError);
  });
});

describe("SUBMIT_SEARCH", () => {
  const search = (node: number, value: string, submit = true): JevAction[] =>
    field(node, "Search", value).map((a) =>
      a.kind === "fill" && submit ? { ...a, submit: true } : a,
    );

  it("is absent when no field is submittable", () => {
    const plan = buildRequest(page([...field(3, "Search", "cats"), button(4, "Go")]), "g", [], {});
    expect(plan.operations).not.toContain("SUBMIT_SEARCH");
    expect(plan.body.questions.submit_search_target).toBeUndefined();
  });

  it("is absent while the submittable field is still empty", () => {
    const plan = buildRequest(page(search(3, "")), "g", [], {});
    expect(plan.operations).not.toContain("SUBMIT_SEARCH");
    expect(actionSpace(search(3, "")).elements[0]?.operations).toEqual(["TYPE_TEXT", "CLICK"]);
  });

  it("is offered for a submittable field that holds a query, targeting only such fields", () => {
    const obs = page([...search(3, "cats"), ...field(5, "Message", "hi"), button(4, "Go")]);
    const plan = buildRequest(obs, "g", [], {});
    expect(plan.operations).toContain("SUBMIT_SEARCH");
    expect(Object.keys(plan.space.targets.SUBMIT_SEARCH ?? {})).toEqual(["1"]);
    expect(plan.space.elements[0]?.operations).toContain("SUBMIT_SEARCH");
    expect(plan.space.elements[1]?.operations).not.toContain("SUBMIT_SEARCH");
    const q = plan.body.questions.submit_search_target as { criteria: Record<string, unknown> };
    expect(Object.keys(q.criteria)).toEqual(["1"]);
    const ops = plan.body.questions.operation as { criteria: Record<string, string> };
    expect(ops.criteria.SUBMIT_SEARCH).toMatch(/Press Enter in a search field/);
  });

  it("interprets a SUBMIT_SEARCH choice as that field", () => {
    const obs = page([...search(3, "cats"), button(4, "Go")]);
    const plan = buildRequest(obs, "g", [], {});
    const d = interpret(
      {
        operation: answer("SUBMIT_SEARCH", plan.operations),
        click_target: answer("1", ["1", "2"]),
        type_text_target: answer("1", ["1"]),
        submit_search_target: answer("1", ["1"]),
      },
      plan,
    );
    expect(d.operation).toBe("SUBMIT_SEARCH");
    expect(d.action?.node).toBe(3);
    expect(d.action?.submit).toBe(true);
  });
});

describe("interpret", () => {
  const obs = page([...field(3, "Where from?"), ...field(5, "Where to?"), button(4, "Search")]);
  const plan = buildRequest(obs, "Zurich to London", [], { from: "Zurich", to: "London" });
  const ids = (name: string) =>
    Object.keys((plan.body.questions[name] as { criteria: object }).criteria);
  const answersFor = (op: string, target: string, fills: Record<string, string>) => {
    const out: Record<string, unknown> = {};
    for (const name of Object.keys(plan.body.questions)) {
      const choice =
        name === "operation"
          ? op
          : name.endsWith("_target")
            ? ids(name).includes(target)
              ? target
              : (ids(name)[0] as string)
            : (fills[name.slice("fill_for_".length)] ?? "NONE");
      out[name] = answer(choice, ids(name));
    }
    return out;
  };

  it("takes the chosen operation's target and that field's fill", () => {
    const d = interpret(answersFor("TYPE_TEXT", "2", { "1": "from", "2": "to" }), plan);
    expect(d.operation).toBe("TYPE_TEXT");
    expect(d.action?.node).toBe(5);
    expect(d.fill).toBe("to");
  });

  it("maps NONE to null when no other field's head names an unused fill", () => {
    expect(interpret(answersFor("TYPE_TEXT", "1", {}), plan).fill).toBeNull();
  });

  describe("retargets a NONE field to the other field whose head names a fill", () => {
    // Three text fields: Jev picks 3 (the output), its head says NONE; 1 and 2
    // each name a fill. Target probability × fill probability picks between them.
    const obs3 = page([
      ...field(3, "Where from?"),
      ...field(5, "Where to?"),
      ...field(7, "Result"),
      button(4, "Search"),
    ]);
    const fills = { from: "Zurich", to: "London" };
    const plan3 = (history: Parameters<typeof buildRequest>[2] = []) =>
      buildRequest(obs3, "Zurich to London", history, fills);
    const probs = (p: Record<string, number>) => {
      const [choice] = Object.entries(p).sort((a, b) => b[1] - a[1])[0] as [string, number];
      return { type: "choice", choice, confidence: 0.9, probabilities: p };
    };
    const answers = (over: Record<string, unknown> = {}) => ({
      operation: answer("TYPE_TEXT", plan3().operations),
      click_target: answer("4", ["1", "2", "3", "4", "5", "6", "7"]),
      type_text_target: probs({ "1": 0.1, "2": 0.3, "3": 0.6 }),
      fill_for_1: probs({ from: 0.9, to: 0.05, NONE: 0.05 }),
      fill_for_2: probs({ from: 0.05, to: 0.5, NONE: 0.45 }),
      fill_for_3: probs({ from: 0.05, to: 0.05, NONE: 0.9 }),
      ...over,
    });

    it("by the highest target × fill probability", () => {
      // 2: 0.3 × 0.5 = 0.15 beats 1: 0.1 × 0.9 = 0.09
      const d = interpret(answers(), plan3());
      expect(d).toMatchObject({ operation: "TYPE_TEXT", targetIndex: "2", fill: "to" });
      expect(d.action?.node).toBe(5);
      expect(d.confidence).toBeCloseTo(0.3);
    });

    it("never re-types a fill already typed this run", () => {
      const entry = { op: "type" as const, label: "Where to?", fill: "to", pageChanged: true };
      const d = interpret(answers(), plan3([entry]));
      expect(d).toMatchObject({ targetIndex: "1", fill: "from" });
      // A stale type never acted, so its fill is still unused.
      const stale = [{ ...entry, stale: "covered" }];
      expect(interpret(answers(), plan3(stale))).toMatchObject({ targetIndex: "2", fill: "to" });
    });

    it("stays NONE when every other head says NONE or names a used fill", () => {
      const none = probs({ from: 0.05, to: 0.05, NONE: 0.9 });
      expect(interpret(answers({ fill_for_1: none, fill_for_2: none }), plan3())).toMatchObject({
        targetIndex: "3",
        fill: null,
      });
      const both = [
        { op: "type" as const, label: "a", fill: "from", pageChanged: true },
        { op: "type" as const, label: "b", fill: "to", pageChanged: true },
      ];
      expect(interpret(answers(), plan3(both))).toMatchObject({ targetIndex: "3", fill: null });
    });

    it("skips an unusable speculative head instead of throwing", () => {
      const bad = { choice: "99", confidence: 2, probabilities: { "99": 0.5 } };
      expect(interpret(answers({ fill_for_2: bad }), plan3())).toMatchObject({
        targetIndex: "1",
        fill: "from",
      });
    });
  });

  it("ignores target questions for operations not chosen", () => {
    const d = interpret(answersFor("DONE", "1", {}), plan);
    expect(d).toMatchObject({ operation: "DONE" });
    expect(d.action).toBeUndefined();
  });

  it("never validates a speculative head: an unusable one for an operation not chosen is ignored", () => {
    const bad = { choice: "99", confidence: 2, probabilities: { "99": 0.5 } };
    // A verdict: every target head and every fill head was speculative.
    const done = answersFor("DONE", "1", {});
    for (const name of Object.keys(plan.body.questions)) if (name !== "operation") done[name] = bad;
    expect(interpret(done, plan)).toMatchObject({ operation: "DONE" });
    // A click: the other operations' target heads and the fill heads were speculative.
    const click = answersFor("CLICK", "3", {});
    click.type_text_target = bad;
    click.fill_for_1 = bad;
    click.fill_for_2 = bad;
    expect(interpret(click, plan)).toMatchObject({ operation: "CLICK", targetIndex: "3" });
    // Typing into field 2: field 1's fill head was speculative.
    const type = answersFor("TYPE_TEXT", "2", { "2": "to" });
    type.click_target = bad;
    type.fill_for_1 = bad;
    expect(interpret(type, plan)).toMatchObject({ operation: "TYPE_TEXT", fill: "to" });
  });

  it("refuses an unusable target answer", () => {
    const a = answersFor("CLICK", "3", {});
    a.click_target = { choice: "99", confidence: 1, probabilities: { "99": 1 } };
    expect(() => interpret(a, plan)).toThrow("unusable");
  });
});
