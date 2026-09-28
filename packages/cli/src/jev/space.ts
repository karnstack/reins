// Port of browser-use/jev-ultrafast model.py action_space/choose (MIT), with
// one fill question per text field instead of a text model.
import type { JevAction, JevObservation } from "@reins/protocol";
import type { ChoiceQuestion, Questions } from "@typesafe-ai/sdk";
import { type ChoiceAnswer, type JevBody, validateChoice, validateNoul } from "./client.js";
import { DONE_CHECK, FILL, NEXT_ACTION, TARGET } from "./prompts.js";
import type { HistoryEntry } from "./types.js";

export type TargetOp = "CLICK" | "TYPE_TEXT" | "SELECT" | "SUBMIT_SEARCH";
const TARGET_OPS: TargetOp[] = ["CLICK", "TYPE_TEXT", "SELECT", "SUBMIT_SEARCH"];
export type ControlOp = "SCROLL_DOWN" | "SCROLL_UP" | "WAIT";
export type Operation = TargetOp | ControlOp | "DONE" | "BLOCKED";

export const MAX_FILL_HEADS = 8;

export interface SpaceElement {
  index: string;
  label: string;
  role?: string;
  value?: string;
  checked?: string;
  selected?: string;
  expanded?: string;
  operations: TargetOp[];
  options?: Array<{ index: string; label: string; value: string }>;
}

export interface ActionSpace {
  elements: SpaceElement[];
  targets: Partial<Record<TargetOp, Record<string, JevAction>>>;
  controls: Partial<Record<ControlOp, JevAction>>;
}

export interface RequestPlan {
  body: JevBody;
  space: ActionSpace;
  operations: string[];
  fillHeads: string[];
  fillNames: string[];
  /** Fills already typed this run (a stale type never acted, so it doesn't count). */
  usedFills: Set<string>;
}

export interface Decision {
  operation: Operation;
  action?: JevAction;
  targetIndex?: string;
  /** Fill name; null = Jev chose NONE; undefined = no fill question was asked. */
  fill?: string | null;
  confidence: number;
}

const OPS: Record<"click" | "fill" | "select", TargetOp> = {
  click: "CLICK",
  fill: "TYPE_TEXT",
  select: "SELECT",
};

const OP_LABELS: Record<TargetOp, string> = {
  CLICK: "Click an element, button, menu option, autocomplete suggestion, or calendar day.",
  TYPE_TEXT: "Enter or replace text in an editable field with one of the values the user supplied.",
  SELECT: "Select an observed dropdown value.",
  SUBMIT_SEARCH:
    "Press Enter in a search field that already holds the typed query, to run the search.",
};

/** SUBMIT_SEARCH candidates: the page marked the field search-like (`submit`),
 *  and it holds something to search for. Enter in any other field could mean
 *  "send", which would slip past the risky-label check. */
const submittable = (a: JevAction): boolean =>
  a.kind === "fill" && a.submit === true && (a.current_value ?? a.value ?? "") !== "";

/** JSON-safe copy (drops undefined), as the SDK's state type requires. */
const json = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** What a target question shows for one candidate; only the states the element has. */
function targetCriterion(index: string, a: JevAction): Record<string, string> {
  const out: Record<string, string> = {
    element: `[${index}] ${a.label}`,
    current_value: a.current_value ?? a.value ?? "",
  };
  for (const key of ["role", "checked", "selected", "expanded"] as const) {
    const v = a[key];
    if (v !== undefined) out[key] = v;
  }
  if (a.offscreen) out.offscreen = "true";
  return out;
}

export function actionSpace(actions: JevAction[]): ActionSpace {
  const elements: SpaceElement[] = [];
  const indices = new Map<number, string>();
  const targets: ActionSpace["targets"] = {};
  const controls: ActionSpace["controls"] = {};
  for (const action of actions) {
    if (action.kind === "scroll" || action.kind === "wait") {
      controls[action.id.toUpperCase() as ControlOp] = action;
      continue;
    }
    if (action.node === undefined) continue;
    let index = indices.get(action.node);
    if (index === undefined) {
      index = String(elements.length + 1);
      indices.set(action.node, index);
      const { role, checked, selected, expanded } = action;
      elements.push({
        index,
        label: action.label.split(" → ")[0] ?? action.label,
        operations: [],
        ...(role !== undefined ? { role } : {}),
        ...(checked !== undefined ? { checked } : {}),
        ...(selected !== undefined ? { selected } : {}),
        ...(expanded !== undefined ? { expanded } : {}),
        ...(action.kind === "select"
          ? { value: action.current_value ?? "", options: [] }
          : action.value !== undefined
            ? { value: action.value }
            : {}),
      });
    }
    const element = elements[Number(index) - 1] as SpaceElement;
    const op = OPS[action.kind];
    if (!element.operations.includes(op)) element.operations.push(op);
    let target = index;
    if (action.kind === "select") {
      element.options ??= [];
      target = `${index}:${element.options.length + 1}`;
      element.options.push({ index: target, label: action.label, value: action.value ?? "" });
    }
    targets[op] ??= {};
    targets[op][target] = action;
    if (submittable(action)) {
      element.operations.push("SUBMIT_SEARCH");
      targets.SUBMIT_SEARCH ??= {};
      targets.SUBMIT_SEARCH[index] = action;
    }
  }
  return { elements, targets, controls };
}

function stateOf(
  obs: JevObservation,
  space: ActionSpace,
  history: HistoryEntry[],
  fills: Record<string, string>,
): unknown {
  return json({
    page: { url: obs.url, title: obs.title, text: obs.text },
    elements: space.elements,
    recent_actions: history.slice(-10).map((h) => ({
      action: h.label,
      kind: h.op,
      fill: h.fill ?? null,
      page_changed: h.pageChanged,
      // An act that never happened: say why, so Jev picks something else.
      ...(h.stale !== undefined
        ? { failed: `could not ${h.op} ${JSON.stringify(h.label)}: ${h.stale}` }
        : {}),
    })),
    supplied_values: fills,
  });
}

function fillQuestion(
  goal: string,
  index: string,
  space: ActionSpace,
  fills: Record<string, string>,
): ChoiceQuestion {
  const field = space.targets.TYPE_TEXT?.[index];
  const criteria: Record<string, string> = {};
  for (const [name, value] of Object.entries(fills)) criteria[name] = `${name}: ${value}`;
  criteria.NONE = "None of the supplied values belongs in this field.";
  return {
    type: "choice",
    criteria,
    instructions: json({
      goal,
      field: `[${index}] ${field?.label ?? ""}`,
      current_value: field?.value ?? "",
      rules: FILL,
    }),
  };
}

export function buildRequest(
  obs: JevObservation,
  goal: string,
  history: HistoryEntry[],
  fills: Record<string, string>,
): RequestPlan {
  const space = actionSpace(obs.actions);
  const operations: Record<string, string> = {};
  for (const op of TARGET_OPS) {
    if (space.targets[op]) operations[op] = OP_LABELS[op];
  }
  for (const [id, a] of Object.entries(space.controls)) operations[id] = a.label;
  operations.DONE = "Every requirement is visibly satisfied.";
  operations.BLOCKED = "No supported operation can progress.";

  const questions: Questions = {
    operation: { type: "choice", criteria: operations, instructions: { goal, rules: NEXT_ACTION } },
  };
  for (const [op, candidates] of Object.entries(space.targets)) {
    questions[`${op.toLowerCase()}_target`] = {
      type: "choice",
      criteria: Object.fromEntries(
        Object.entries(candidates).map(([index, a]) => [index, targetCriterion(index, a)]),
      ),
      instructions: { goal, operation: op, rules: [NEXT_ACTION, TARGET] },
    };
  }
  const fillNames = Object.keys(fills);
  const fillHeads =
    fillNames.length === 0
      ? []
      : Object.keys(space.targets.TYPE_TEXT ?? {}).slice(0, MAX_FILL_HEADS);
  for (const index of fillHeads)
    questions[`fill_for_${index}`] = fillQuestion(goal, index, space, fills);
  const usedFills = new Set<string>();
  for (const h of history) if (h.fill !== undefined && h.stale === undefined) usedFills.add(h.fill);
  return {
    body: { state: stateOf(obs, space, history, fills), questions },
    space,
    operations: Object.keys(operations),
    fillHeads,
    fillNames,
    usedFills,
  };
}

/** A second, rare request: the fill for a field beyond the first MAX_FILL_HEADS. */
export function fillOnlyRequest(
  obs: JevObservation,
  goal: string,
  history: HistoryEntry[],
  fills: Record<string, string>,
  index: string,
): JevBody {
  const space = actionSpace(obs.actions);
  return {
    state: stateOf(obs, space, history, fills),
    questions: { [`fill_for_${index}`]: fillQuestion(goal, index, space, fills) },
  };
}

/** The self-check asked when Jev chooses DONE: on the same observation, one
 *  yes/no question — is every requirement of the goal visibly satisfied? */
export function doneCheckRequest(
  obs: JevObservation,
  goal: string,
  history: HistoryEntry[],
  fills: Record<string, string>,
): JevBody {
  const space = actionSpace(obs.actions);
  return {
    state: stateOf(obs, space, history, fills),
    questions: {
      satisfied: {
        type: "noul",
        instructions: { goal, rules: DONE_CHECK },
        criteria: {
          true: "The current page visibly satisfies every requirement of the goal.",
          false:
            "At least one requirement of the goal is not yet visibly satisfied on the current page.",
        },
      },
    },
  };
}

/** The self-check's probability that the goal is satisfied. */
export function interpretDoneCheck(answers: Record<string, unknown>): number {
  return validateNoul(answers.satisfied);
}

export function interpretFill(
  answers: Record<string, unknown>,
  fillNames: string[],
  index: string,
): string | null {
  const a = validateChoice(answers[`fill_for_${index}`], [...fillNames, "NONE"]);
  return a.choice === "NONE" ? null : a.choice;
}

/** Jev chose a text field whose own fill head says NONE (an output field,
 *  say, while the fills fit other fields). Rather than stop for text, type
 *  into the other offered field whose speculative fill head names a fill not
 *  yet typed this run — the one with the highest target probability × fill
 *  probability. An unusable speculative head is skipped, never thrown on.
 *  Undefined when no such field exists (then the run stops `needs_text`). */
function retargetFill(
  answers: Record<string, unknown>,
  plan: RequestPlan,
  target: ChoiceAnswer,
  chosen: Decision,
): Decision | undefined {
  const candidates = plan.space.targets.TYPE_TEXT ?? {};
  let best: { decision: Decision; score: number } | undefined;
  for (const index of plan.fillHeads) {
    if (index === chosen.targetIndex || !(index in candidates)) continue;
    let fillAnswer: ChoiceAnswer;
    try {
      fillAnswer = validateChoice(answers[`fill_for_${index}`], [...plan.fillNames, "NONE"]);
    } catch {
      continue;
    }
    const fill = fillAnswer.choice;
    if (fill === "NONE" || plan.usedFills.has(fill)) continue;
    const pTarget = target.probabilities[index] ?? 0;
    const pFill = fillAnswer.probabilities[fill] ?? 0;
    const score = pTarget * pFill;
    if (best && score <= best.score) continue;
    best = {
      score,
      decision: {
        operation: "TYPE_TEXT",
        action: candidates[index],
        targetIndex: index,
        fill,
        confidence: Math.min(chosen.confidence, pTarget, fillAnswer.confidence),
      },
    };
  }
  return best?.decision;
}

export function interpret(answers: Record<string, unknown>, plan: RequestPlan): Decision {
  const op = validateChoice(answers.operation, plan.operations);
  const operation = op.choice as Operation;
  if (TARGET_OPS.includes(operation as TargetOp)) {
    const candidates = plan.space.targets[operation as TargetOp] ?? {};
    // Only the chosen operation's head can act; the others were speculative.
    const t = validateChoice(answers[`${operation.toLowerCase()}_target`], Object.keys(candidates));
    const decision: Decision = {
      operation,
      action: candidates[t.choice],
      targetIndex: t.choice,
      confidence: Math.min(op.confidence, t.confidence),
    };
    if (operation === "TYPE_TEXT" && plan.fillHeads.includes(t.choice)) {
      decision.fill = interpretFill(answers, plan.fillNames, t.choice);
      if (decision.fill === null) return retargetFill(answers, plan, t, decision) ?? decision;
    }
    return decision;
  }
  const control = plan.space.controls[operation as ControlOp];
  return { operation, ...(control ? { action: control } : {}), confidence: op.confidence };
}
