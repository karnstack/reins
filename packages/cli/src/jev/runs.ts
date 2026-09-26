import type { RunState } from "./types.js";

const DEFAULT_TTL_MS = 15 * 60_000;

export function newRun(
  goal: string,
  startHost: string | undefined,
  fills: Record<string, string>,
  confirms: string[],
  now: number,
): RunState {
  return {
    goal,
    startHost,
    fills: { ...fills },
    confirms: [...confirms],
    history: [],
    step: 0,
    jevCalls: 0,
    pageChanges: 0,
    updatedAt: now,
  };
}

/** In-memory run state for `--continue`: gone after the TTL or a restart. */
export class RunStore {
  readonly #runs = new Map<string, RunState>();
  readonly #active = new Set<string>();
  readonly #ttlMs: number;
  readonly #now: () => number;

  constructor(opts: { ttlMs?: number; now?: () => number } = {}) {
    this.#ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
    this.#now = opts.now ?? Date.now;
  }

  /** Tab ids repeat across browsers, so the browser is part of the key. */
  static key(browserId: string, tabId: number): string {
    return `${browserId}:${tabId}`;
  }

  get(key: string): RunState | undefined {
    const run = this.#runs.get(key);
    if (run && this.#now() - run.updatedAt > this.#ttlMs) {
      this.#runs.delete(key);
      return undefined;
    }
    return run;
  }

  set(key: string, state: RunState): void {
    this.#runs.set(key, { ...state, updatedAt: this.#now() });
  }

  tryBegin(key: string): boolean {
    if (this.#active.has(key)) return false;
    this.#active.add(key);
    return true;
  }

  end(key: string): void {
    this.#active.delete(key);
  }
}
