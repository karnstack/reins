import type { JevAction, JevObservation } from "@reins/protocol";
import { describe, expect, it } from "vitest";
import { actionSpace, buildRequest, interpret, MAX_FILL_HEADS } from "./space.js";

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

  it("maps NONE to null", () => {
    expect(interpret(answersFor("TYPE_TEXT", "1", {}), plan).fill).toBeNull();
  });

  it("ignores target questions for operations not chosen", () => {
    const d = interpret(answersFor("DONE", "1", {}), plan);
    expect(d).toMatchObject({ operation: "DONE" });
    expect(d.action).toBeUndefined();
  });

  it("refuses an unusable target answer", () => {
    const a = answersFor("CLICK", "3", {});
    a.click_target = { choice: "99", confidence: 1, probabilities: { "99": 1 } };
    expect(() => interpret(a, plan)).toThrow("unusable");
  });
});
