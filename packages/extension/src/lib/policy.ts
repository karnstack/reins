import {
  DEFAULT_POLICY,
  effectiveTier,
  type GatedMethod,
  METHOD_TIERS,
  normalizePattern,
  Policy,
  type ResponseMeta,
  Tier,
  tighterThan,
} from "@reins/protocol";
import { removeRule, setDefaultTier, upsertRule } from "./policy-view.js";

/** chrome.storage.local key. The popup reads/writes the same key directly. */
export const POLICY_KEY = "reinsPolicy";

/** Refused by the policy gate. `code` survives to the ResponseFrame. */
export class PolicyDenied extends Error {
  readonly code = "policy_denied";
  /** Resolved target for the audit trail; the dispatch gate adds tabId. */
  meta?: ResponseMeta;
}

let cached: Policy | undefined;
let watching = false;

export function resetPolicyCacheForTests(): void {
  cached = undefined;
  watching = false;
}

/**
 * Current policy, cached in the worker; any local-storage change (popup
 * edit, tighten) drops the cache. Corrupt storage throws — the dispatch
 * gate then refuses the request (fail closed), it never falls back to
 * full access.
 */
export async function policy(): Promise<Policy> {
  if (!watching) {
    watching = true;
    chrome.storage.onChanged.addListener((_changes, area) => {
      if (area === "local") cached = undefined;
    });
  }
  if (cached === undefined) {
    const got = await chrome.storage.local.get(POLICY_KEY);
    const raw = got[POLICY_KEY];
    cached = raw === undefined ? DEFAULT_POLICY : Policy.parse(raw);
  }
  return cached;
}

export async function savePolicy(p: Policy): Promise<void> {
  cached = undefined;
  await chrome.storage.local.set({ [POLICY_KEY]: p });
}

/**
 * All policy mutations run through one promise chain in this worker — the
 * single writer. Interleaved read-modify-writes (popup click racing a CLI
 * tighten) would otherwise silently drop whichever write lands first.
 */
let writeChain: Promise<unknown> = Promise.resolve();

function enqueueWrite<T>(fn: () => Promise<T>): Promise<T> {
  const next = writeChain.then(fn, fn);
  writeChain = next.catch(() => {});
  return next;
}

/**
 * Apply a strictly-tightening rule change. The comparison runs here, in the
 * extension — the daemon (any local process) cannot loosen policy. Grants
 * go through the popup (reins:policy-change → applyPolicyChange).
 */
export function tightenPolicy(patternInput: string, tier: Tier): Promise<Policy> {
  return enqueueWrite(async () => {
    const pattern = normalizePattern(patternInput);
    const p = await policy();
    const existing = p.rules.find((r) => r.pattern === pattern);
    const current =
      existing?.tier ?? effectiveTier(p, pattern.startsWith("*.") ? pattern.slice(2) : pattern);
    if (!tighterThan(tier, current)) {
      throw new PolicyDenied(
        `policy_tighten can only restrict: "${pattern}" is already ${current} — grants require the extension popup`,
      );
    }
    const rules = existing
      ? p.rules.map((r) => (r.pattern === pattern ? { ...r, tier } : r))
      : [...p.rules, { pattern, tier }];
    const next: Policy = { ...p, rules };
    await savePolicy(next);
    return next;
  });
}

/** A popup-initiated policy edit. Unlike tighten, these may loosen — the
 *  popup click IS the user's grant gesture; only extension pages can send
 *  the runtime message that carries them. */
export type PolicyChange =
  | { kind: "upsert"; pattern: string; tier: Tier }
  | { kind: "remove"; pattern: string }
  | { kind: "setDefault"; tier: Tier };

/** Validate + apply a popup edit through the single-writer queue. */
export function applyPolicyChange(change: PolicyChange): Promise<Policy> {
  return enqueueWrite(async () => {
    const p = await policy();
    let next: Policy;
    switch (change.kind) {
      case "upsert":
        next = upsertRule(p, change.pattern, Tier.parse(change.tier));
        break;
      case "remove":
        next = removeRule(p, normalizePattern(change.pattern));
        break;
      case "setDefault":
        next = setDefaultTier(p, Tier.parse(change.tier));
        break;
      default:
        throw new Error("unknown policy change");
    }
    await savePolicy(next);
    return next;
  });
}

/** Throw PolicyDenied unless `host`'s tier covers `method`'s required tier;
 *  return the effective tier so dispatch can stamp it on the response. */
export async function ensureAllowed(method: GatedMethod, host: string | undefined): Promise<Tier> {
  const tier = effectiveTier(await policy(), host);
  const required = METHOD_TIERS[method];
  if (tier === "full" || (tier === "read" && required === "read")) return tier;
  const label = host ?? "this tab";
  const err = new PolicyDenied(
    tier === "deny"
      ? `blocked by policy: ${label} is denied — change its tier from the reins extension popup`
      : `blocked by policy: ${label} is read-only — grant full access from the reins extension popup`,
  );
  err.meta = { host, tier };
  throw err;
}
