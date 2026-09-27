export type StepOp = "click" | "type" | "select" | "submit" | "scroll" | "wait";

export interface HistoryEntry {
  op: StepOp;
  label: string;
  fill?: string;
  /** null until the next observation says whether the page changed. */
  pageChanged: boolean | null;
  /** Set when the act never happened (the target was gone, covered, moving):
   *  the reason, so Jev can choose differently. Not a step; never resolved. */
  stale?: string;
  /** A verdict the loop refused (a DONE the self-check rejected): what Jev is
   *  told about it. Not an act: never resolved, never counts as progress or
   *  as its absence. */
  note?: string;
}

export type DoStatus =
  | "done"
  | "risky_action"
  | "needs_text"
  | "left_site"
  | "dialog"
  | "interrupted"
  | "blocked"
  | "stuck"
  | "budget"
  | "error";

export interface DoStep {
  /** Step number within the whole run (continues across --continue). */
  n: number;
  op: StepOp;
  label: string;
  fill?: string;
  confidence: number;
  ms: number;
  pageChanged: boolean | null;
  /** The click opened this tab; the run moved to it. */
  openedTabId?: number;
}

export interface DoResult {
  status: DoStatus;
  reason?: string;
  /** The exact command to run next. */
  next?: string;
  pending?: { op: "click" | "type" | "submit"; label: string };
  steps: DoStep[];
  /** The tab the run is on now (set by handleDo; a link may have opened a new one). */
  tabId?: number;
  url: string;
  title: string;
  elapsedMs: number;
  jevCalls: number;
  /** Input tokens over every Jev call of this invocation (output tokens are free). */
  inputTokens: number;
  step: number;
  maxSteps: number;
  pageChanges: number;
  /** For `done`: the self-check's probability that the goal is satisfied on
   *  the final page (absent when the check could not run). Below the loop's
   *  threshold only when two earlier DONEs were already rejected. */
  doneConfidence?: number;
}

export interface RunState {
  goal: string;
  startHost: string | undefined;
  fills: Record<string, string>;
  confirms: string[];
  history: HistoryEntry[];
  step: number;
  jevCalls: number;
  pageChanges: number;
  lastFingerprint?: string;
  /** Set by the loop breaker: --continue refuses while the page still matches. */
  lockedFingerprint?: string;
  updatedAt: number;
}

export function doExitCode(r: DoResult): 0 | 1 | 2 {
  return r.status === "done" ? 0 : r.status === "error" ? 1 : 2;
}
