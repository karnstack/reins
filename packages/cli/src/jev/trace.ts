// Opt-in diagnostics for `reins do`: one JSON line per Jev call, appended to
// the file named by REINS_JEV_TRACE (read once, at daemon start). The line
// carries what Jev was asked (question keys) and what it answered (chosen
// operation and its probabilities, the chosen target per head, the chosen
// fill) plus the call's cost — never the page text, the fill values, or the key.
import { appendFileSync } from "node:fs";
import type { JevAsk } from "./client.js";

export interface JevTraceChoice {
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
}

export interface JevTraceLine {
  /** ISO time the call started. */
  t: string;
  ms: number;
  questions: string[];
  operation?: JevTraceChoice;
  /** Chosen target per `*_target` head, keyed by head name. */
  targets: Record<string, JevTraceChoice>;
  /** Chosen fill name per `fill_for_*` head (NONE when Jev declined). */
  fills: Record<string, string>;
  inputTokens: number;
  error?: string;
}

export type TraceSink = (line: JevTraceLine) => void;

/** Appends JSON lines to `file`; a write failure is dropped, never surfaced. */
export function fileTraceSink(file: string): TraceSink {
  return (line) => {
    try {
      appendFileSync(file, `${JSON.stringify(line)}\n`);
    } catch {
      // diagnostics never affect the run
    }
  };
}

function choiceOf(v: unknown): JevTraceChoice | undefined {
  const a = v as Partial<JevTraceChoice> | undefined;
  if (!a || typeof a.choice !== "string") return undefined;
  const probabilities: Record<string, number> = {};
  if (a.probabilities && typeof a.probabilities === "object") {
    for (const [k, n] of Object.entries(a.probabilities)) {
      if (typeof n === "number") probabilities[k] = Number(n.toFixed(4));
    }
  }
  return {
    choice: a.choice,
    confidence: typeof a.confidence === "number" ? Number(a.confidence.toFixed(4)) : 0,
    probabilities,
  };
}

/** The trace line for one answered request. Only answer shapes are read;
 *  the request state (page text, fill values) is never touched. */
export function summarizeAnswers(
  questionKeys: string[],
  answers: Record<string, unknown>,
): Pick<JevTraceLine, "operation" | "targets" | "fills"> {
  const out: Pick<JevTraceLine, "operation" | "targets" | "fills"> = { targets: {}, fills: {} };
  for (const key of questionKeys) {
    const c = choiceOf(answers[key]);
    if (!c) continue;
    if (key === "operation") out.operation = c;
    else if (key.endsWith("_target")) out.targets[key] = c;
    else if (key.startsWith("fill_for_")) out.fills[key] = c.choice;
  }
  return out;
}

/**
 * Wrap an ask so every call (answered or failed) writes one line. `tokens`
 * is the running input-token total the caller keeps via `onUsage`; the line
 * records the difference around the call.
 */
export function traceAsk(
  ask: JevAsk,
  sink: TraceSink,
  tokens: () => number = () => 0,
  now: () => number = Date.now,
): JevAsk {
  return async (body, signal) => {
    const t0 = now();
    const before = tokens();
    const questions = Object.keys(body.questions);
    try {
      const answers = await ask(body, signal);
      sink({
        t: new Date(t0).toISOString(),
        ms: now() - t0,
        questions,
        ...summarizeAnswers(questions, answers),
        inputTokens: tokens() - before,
      });
      return answers;
    } catch (err) {
      sink({
        t: new Date(t0).toISOString(),
        ms: now() - t0,
        questions,
        targets: {},
        fills: {},
        inputTokens: tokens() - before,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  };
}
