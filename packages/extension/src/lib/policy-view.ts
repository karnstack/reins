import { normalizePattern, type Policy, type Tier } from "@reins/protocol";

/** Set `pattern` to `tier`, replacing any existing rule. Popup-only surface:
 *  this may loosen — the user's click in the popup IS the grant gesture. */
export function upsertRule(p: Policy, patternInput: string, tier: Tier): Policy {
  const pattern = normalizePattern(patternInput);
  const rest = p.rules.filter((r) => r.pattern !== pattern);
  return { ...p, rules: [...rest, { pattern, tier }] };
}

export function removeRule(p: Policy, pattern: string): Policy {
  return { ...p, rules: p.rules.filter((r) => r.pattern !== pattern) };
}

export function setDefaultTier(p: Policy, tier: Tier): Policy {
  return { ...p, defaultTier: tier };
}
