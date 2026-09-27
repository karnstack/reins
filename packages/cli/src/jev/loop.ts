import { hostOf, type JevActParams, type JevActResult, type JevObservation } from "@reins/protocol";
import type { JevAsk } from "./client.js";
import { fingerprint, noProgress, normalizeLabel, riskyReason, sameSite } from "./rules.js";
import {
  buildRequest,
  fillOnlyRequest,
  interpret,
  interpretFill,
  type Operation,
} from "./space.js";
import type { DoResult, DoStatus, DoStep, RunState, StepOp } from "./types.js";

export interface LoopDeps {
  observe(): Promise<JevObservation>;
  act(params: Omit<JevActParams, "browserId" | "tabId">): Promise<JevActResult>;
  ask: JevAsk;
  now(): number;
  /** Input tokens `ask` has consumed so far (summed by whoever created it). */
  inputTokens?(): number;
  /** A click opened a new tab: every later observe/act goes there. */
  retarget?(tabId: number): void;
}

export interface LoopInput {
  run: RunState;
  /** Actions this invocation may execute. */
  maxSteps: number;
  timeoutMs: number;
  signal: AbortSignal;
  /** True for --continue. */
  continued: boolean;
  /** An observation the caller already made (saves one round trip). */
  first?: JevObservation;
}

const OP_OF: Record<Exclude<Operation, "DONE" | "BLOCKED">, StepOp> = {
  CLICK: "click",
  TYPE_TEXT: "type",
  SELECT: "select",
  SUBMIT_SEARCH: "submit",
  SCROLL_DOWN: "scroll",
  SCROLL_UP: "scroll",
  WAIT: "wait",
};

/** Statuses the --continue loop breaker may turn into `stuck`. The page-side
 *  stops (dialog, left_site, interrupted) stay as they are: they say what
 *  happened, and the page did move in a way the fingerprint can't see. */
const BREAKABLE: DoStatus[] = ["risky_action", "needs_text", "blocked", "budget", "stuck"];

function abortReason(signal: AbortSignal): string {
  const r = signal.reason as unknown;
  return r instanceof Error ? r.message : typeof r === "string" ? r : "stopped";
}

/** handleDo aborts the signal with a TimeoutError when --timeout elapses:
 *  that is the run's own budget, not someone hanging up on it. */
function timedOut(signal: AbortSignal): boolean {
  const r = signal.reason as unknown;
  return r instanceof Error && r.name === "TimeoutError";
}

/** The `reins do` state machine: observe → ask Jev → gate → act → record,
 *  until a stop rule fires. Never throws; failures come back as `error`. */
export async function runLoop(
  deps: LoopDeps,
  input: LoopInput,
): Promise<{ result: DoResult; run: RunState }> {
  const started = deps.now();
  const run: RunState = structuredClone(input.run);
  const stepLimit = run.step + input.maxSteps;
  const callLimit = input.maxSteps * 2;
  const steps: DoStep[] = [];
  let calls = 0;
  let executed = 0;
  let changed = 0;
  // Consecutive acts that never happened (stale target). Each is re-read
  // without a step, but Jev tends to pick the same element again; three in
  // a row is stuck rather than a budget burnt on re-reads.
  let staleRun = 0;
  let url = "";
  let title = "";

  const stop = (
    status: DoStatus,
    extra: Pick<DoResult, "reason" | "pending"> = {},
  ): { result: DoResult; run: RunState } => {
    let final = status;
    let reason = extra.reason;
    // Loop breaker: a --continue that acted but moved nothing is stuck, and
    // the next --continue refuses until the page itself changes. Only fires
    // when the last action's outcome was actually observed: an abort or
    // timeout before the next read says nothing about the page, and a stale
    // act (never happened) says nothing either — look past it.
    const last = run.history.findLast((h) => h.stale === undefined);
    if (
      input.continued &&
      executed > 0 &&
      changed === 0 &&
      last !== undefined &&
      last.pageChanged !== null &&
      BREAKABLE.includes(status)
    ) {
      final = "stuck";
      reason = `this --continue ran ${executed} action${executed === 1 ? "" : "s"} and none changed the page`;
      run.lockedFingerprint = run.lastFingerprint;
    }
    run.jevCalls += calls;
    return {
      result: {
        status: final,
        ...(reason !== undefined ? { reason } : {}),
        ...(extra.pending && final === status ? { pending: extra.pending } : {}),
        steps,
        url,
        title,
        elapsedMs: deps.now() - started,
        jevCalls: calls,
        inputTokens: deps.inputTokens?.() ?? 0,
        step: run.step,
        maxSteps: stepLimit,
        pageChanges: run.pageChanges,
      },
      run,
    };
  };

  const timeoutReason = `timed out after ${Math.round(input.timeoutMs / 1000)}s`;
  const aborted = (): { result: DoResult; run: RunState } =>
    timedOut(input.signal)
      ? stop("budget", { reason: timeoutReason })
      : stop("interrupted", { reason: abortReason(input.signal) });

  let obs = input.first;
  let first = true;
  try {
    for (;;) {
      if (input.signal.aborted) return aborted();
      if (deps.now() - started >= input.timeoutMs) return stop("budget", { reason: timeoutReason });
      obs ??= await deps.observe();
      // A blocked page can't be read: the observation under a dialog carries
      // no text or actions, so it must not become the run's fingerprint. But
      // the dialog is what the last action did — count it as a page change,
      // or three clicks that each opened one (and were each dismissed) would
      // read as three no-ops and stop the run as stuck. Keep the previous
      // url/title when the observation has none (older extensions).
      if (obs.dialog) {
        if (obs.url) url = obs.url;
        if (obs.title) title = obs.title;
        const prev = run.history.at(-1);
        if (prev && prev.pageChanged === null && prev.stale === undefined) {
          prev.pageChanged = true;
          run.pageChanges += 1;
          changed += 1;
          const s = steps.at(-1);
          if (s && s.n === run.step) s.pageChanged = true;
        }
        return stop("dialog", {
          reason: `a JavaScript ${obs.dialog.type} is open: ${JSON.stringify(obs.dialog.message)}`,
        });
      }
      url = obs.url;
      title = obs.title;
      // Resolve the last action's outcome before any stop below, so every
      // result records it.
      const fp = fingerprint(obs);
      const prev = run.history.at(-1);
      if (prev && prev.pageChanged === null && prev.stale === undefined) {
        prev.pageChanged = fp !== run.lastFingerprint;
        if (prev.pageChanged) {
          run.pageChanges += 1;
          changed += 1;
        }
        const s = steps.at(-1);
        if (s && s.n === run.step) s.pageChanged = prev.pageChanged;
      }
      run.lastFingerprint = fp;
      if (first && input.continued && run.lockedFingerprint === fp) {
        return stop("stuck", {
          reason: "the last --continue changed nothing, and the page hasn't changed since",
        });
      }
      if (run.lockedFingerprint !== undefined && run.lockedFingerprint !== fp) {
        delete run.lockedFingerprint;
      }
      if (!obs.visible && !first) {
        return stop("interrupted", { reason: "the tab was hidden (did you switch tabs?)" });
      }
      const host = hostOf(obs.url);
      // A run that began on about:blank / file:// / an error page has no
      // start host yet: the first http(s) page it reaches becomes the site.
      if (run.startHost === undefined && host !== undefined) run.startHost = host;
      if (!sameSite(run.startHost, host)) {
        return stop("left_site", { reason: `the page moved to ${host}, outside ${run.startHost}` });
      }
      if (noProgress(run.history))
        return stop("stuck", { reason: "3 actions in a row changed nothing" });
      if (calls >= callLimit) return stop("budget", { reason: `reached ${callLimit} Jev calls` });
      first = false;

      const plan = buildRequest(obs, run.goal, run.history, run.fills);
      calls += 1;
      const decision = interpret(await deps.ask(plan.body, input.signal), plan);
      if (
        decision.operation === "TYPE_TEXT" &&
        decision.fill === undefined &&
        plan.fillNames.length > 0 &&
        decision.targetIndex !== undefined
      ) {
        if (calls >= callLimit) return stop("budget", { reason: `reached ${callLimit} Jev calls` });
        calls += 1;
        const body = fillOnlyRequest(obs, run.goal, run.history, run.fills, decision.targetIndex);
        decision.fill = interpretFill(
          await deps.ask(body, input.signal),
          plan.fillNames,
          decision.targetIndex,
        );
      }

      if (decision.operation === "DONE") return stop("done");
      if (decision.operation === "BLOCKED") {
        return stop("blocked", { reason: "Jev found nothing on the page that can make progress" });
      }
      const action = decision.action;
      if (!action) {
        return stop("error", {
          reason: `Jev chose ${decision.operation}, which this page doesn't offer`,
        });
      }
      if (decision.operation === "CLICK" || decision.operation === "SUBMIT_SEARCH") {
        // Enter in a field is a click on its form's submit: the field's label
        // gets the same check (a search label won't trip it).
        const op = decision.operation === "CLICK" ? "click" : "submit";
        const why = riskyReason({ ...action, kind: "click" }, run.goal, run.confirms);
        if (why) {
          return stop("risky_action", {
            reason: `next ${op} is ${JSON.stringify(action.label)} (${why})`,
            pending: { op, label: action.label },
          });
        }
      }
      if (decision.operation === "TYPE_TEXT" && !decision.fill) {
        return stop("needs_text", {
          reason:
            plan.fillNames.length > 0
              ? `field ${JSON.stringify(action.label)} matched none of your --fill values`
              : `field ${JSON.stringify(action.label)} has no --fill`,
          pending: { op: "type", label: action.label },
        });
      }
      if (run.step >= stepLimit)
        return stop("budget", { reason: `reached ${input.maxSteps} steps` });
      if (input.signal.aborted) return aborted();

      const op = OP_OF[decision.operation];
      const fill = decision.fill ?? undefined;
      const t0 = deps.now();
      const res = await deps.act({
        op,
        ...(action.node !== undefined ? { node: action.node } : {}),
        label: action.label,
        ...(op === "type" && fill ? { text: run.fills[fill] } : {}),
        ...(op === "select" && action.value !== undefined ? { value: action.value } : {}),
        ...(op === "scroll" && action.delta !== undefined ? { delta: action.delta } : {}),
      });
      obs = undefined;
      if ("stale" in res) {
        // Nothing happened: read again, no step used — but remember why, and
        // give up after three in a row.
        run.history.push({ op, label: action.label, pageChanged: null, stale: res.reason });
        if (++staleRun >= 3) {
          return stop("stuck", {
            reason: `couldn't act on ${JSON.stringify(action.label)}: ${res.reason}`,
          });
        }
        continue;
      }
      staleRun = 0;
      const openedTabId = "openedTabId" in res ? res.openedTabId : undefined;
      if (openedTabId !== undefined) deps.retarget?.(openedTabId);

      if (op === "click" || op === "submit") {
        const i = run.confirms.findIndex((c) => normalizeLabel(c) === normalizeLabel(action.label));
        if (i >= 0) run.confirms.splice(i, 1);
      }
      run.step += 1;
      executed += 1;
      run.history.push({ op, label: action.label, ...(fill ? { fill } : {}), pageChanged: null });
      steps.push({
        n: run.step,
        op,
        label: action.label,
        ...(fill ? { fill } : {}),
        confidence: decision.confidence,
        ms: deps.now() - t0,
        pageChanged: null,
        ...(openedTabId !== undefined ? { openedTabId } : {}),
      });
    }
  } catch (err) {
    if (input.signal.aborted) return aborted();
    return stop("error", { reason: err instanceof Error ? err.message : String(err) });
  }
}
