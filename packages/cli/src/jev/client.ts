import {
  APIConnectionError,
  APIError,
  APIUserAbortError,
  AuthenticationError,
  type Fetch,
  PermissionDeniedError,
  type Questions,
  type RetryPolicy,
  TypeSafeClient,
} from "@typesafe-ai/sdk";

export type JevErrorCode = "key_rejected" | "http" | "network" | "invalid_answer";

/** Every failure says that nothing happened: an unusable answer never acts. */
export class JevError extends Error {
  constructor(
    message: string,
    readonly code: JevErrorCode,
  ) {
    super(message);
  }
}

export interface ChoiceAnswer {
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
}

export interface JevBody {
  state: unknown;
  questions: Questions;
}

/** One Jev request → the answers keyed by question name. */
export type JevAsk = (body: JevBody, signal?: AbortSignal) => Promise<Record<string, unknown>>;

const ATTEMPT_TIMEOUT_MS = 8000;

function translate(err: unknown): unknown {
  if (err instanceof APIUserAbortError) return err; // the run was stopped; let the loop say so
  if (
    err instanceof AuthenticationError ||
    err instanceof PermissionDeniedError ||
    (err instanceof APIError && (err.status === 401 || err.status === 403))
  ) {
    return new JevError(
      "TypeSafe rejected the API key — replace it with `reins key set typesafe` or in the extension popup",
      "key_rejected",
    );
  }
  if (err instanceof APIError) {
    return new JevError(`TypeSafe returned HTTP ${err.status} — no action was taken`, "http");
  }
  if (err instanceof APIConnectionError) {
    return new JevError("couldn't reach TypeSafe — no action was taken", "network");
  }
  return err;
}

export function createJevAsk(opts: {
  key: string;
  fetch?: Fetch;
  retry?: Partial<RetryPolicy>;
}): JevAsk {
  const client = new TypeSafeClient({
    apiKey: opts.key,
    logLevel: "off",
    timeout: ATTEMPT_TIMEOUT_MS,
    ...(opts.fetch ? { fetch: opts.fetch } : {}),
    ...(opts.retry ? { retry: opts.retry } : {}),
  });
  return async (body, signal) => {
    try {
      const result = await client.systemOne(
        // The SDK types state as JSON; our state is built from JSON-safe parts.
        body as Parameters<typeof client.systemOne>[0],
        signal ? { signal } : {},
      );
      return result.answers as Record<string, unknown>;
    } catch (err) {
      throw translate(err);
    }
  };
}

/**
 * Check a choice answer beyond its type: the choice was offered, every option
 * has exactly one probability in [0, 1], they sum to ~1, and the choice is the
 * most likely. Anything else is an unusable answer — never act on it.
 */
export function validateChoice(answer: unknown, ids: string[]): ChoiceAnswer {
  const a = answer as Partial<ChoiceAnswer> | undefined;
  const probs = a?.probabilities;
  const values = probs && typeof probs === "object" ? Object.values(probs) : [];
  const valid =
    !!a &&
    typeof a.choice === "string" &&
    ids.includes(a.choice) &&
    !!probs &&
    typeof probs === "object" &&
    Object.keys(probs).length === ids.length &&
    ids.every((id) => Object.hasOwn(probs, id)) &&
    [...values, a.confidence].every(
      (n) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1,
    ) &&
    Math.abs(values.reduce((s, n) => s + n, 0) - 1) < 0.02 &&
    (probs[a.choice] ?? 0) >= Math.max(...values) - 1e-6;
  if (!valid) {
    throw new JevError(
      "TypeSafe returned an unusable answer — no action was taken",
      "invalid_answer",
    );
  }
  return a as ChoiceAnswer;
}

/** One minimal call: resolves when TypeSafe accepts the key. */
export async function validateKey(key: string, opts: { fetch?: Fetch } = {}): Promise<void> {
  const ask = createJevAsk({ key, ...opts });
  await ask({
    state: "reins key check",
    questions: { ok: { type: "noul", instructions: "Is this text non-empty?" } },
  });
}
