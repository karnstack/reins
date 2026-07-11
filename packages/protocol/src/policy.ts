import { z } from "zod";

/** Per-host permission tier, ordered deny < read < full. */
export const Tier = z.enum(["deny", "read", "full"]);
export type Tier = z.infer<typeof Tier>;

const ORDER: Record<Tier, number> = { deny: 0, read: 1, full: 2 };

/** true when `a` is strictly more restrictive than `b`. */
export function tighterThan(a: Tier, b: Tier): boolean {
  return ORDER[a] < ORDER[b];
}

/** pattern: "host.com" (exact) or "*.host.com" (subdomains + apex). */
export const PolicyRule = z.object({ pattern: z.string().min(1), tier: Tier });
export type PolicyRule = z.infer<typeof PolicyRule>;

export const Policy = z.object({ defaultTier: Tier, rules: z.array(PolicyRule) });
export type Policy = z.infer<typeof Policy>;

/** Shipped default: today's all-access behavior. Policy is opt-in hardening. */
export const DEFAULT_POLICY: Policy = { defaultTier: "full", rules: [] };

const HOST_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;

/** Normalize user input to a rule pattern: lowercase, scheme/port/path
 *  stripped, at most one leading `*.`. Throws on anything else. */
export function normalizePattern(input: string): string {
  let p = input.trim().toLowerCase();
  p = p.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  const wildcard = p.startsWith("*.");
  if (wildcard) p = p.slice(2);
  p = p.replace(/[/:?#].*$/, "");
  if (!HOST_RE.test(p)) {
    throw new Error(`invalid pattern: ${JSON.stringify(input)} (use "host.com" or "*.host.com")`);
  }
  return wildcard ? `*.${p}` : p;
}

/** Host of an http(s) URL, lowercase; undefined for any other scheme or
 *  unparseable input (chrome://, about:, …) — those get the default tier.
 *  Trailing dots are stripped: `https://bank.com./` must match a `bank.com`
 *  rule, or the FQDN form would bypass per-host policy. */
export function hostOf(url: string): string | undefined {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return undefined;
    const host = u.hostname.toLowerCase().replace(/\.+$/, "");
    return host === "" ? undefined : host;
  } catch {
    return undefined;
  }
}

function wildcardMatches(pattern: string, host: string): boolean {
  const apex = pattern.slice(2);
  return host === apex || host.endsWith(`.${apex}`);
}

/** Effective tier for a host: exact rule > longest matching wildcard >
 *  defaultTier. `undefined` host (non-http(s) tab) → defaultTier. */
export function effectiveTier(policy: Policy, host: string | undefined): Tier {
  if (host === undefined) return policy.defaultTier;
  const h = host.toLowerCase();
  const exact = policy.rules.find((r) => !r.pattern.startsWith("*.") && r.pattern === h);
  if (exact) return exact.tier;
  const wild = policy.rules
    .filter((r) => r.pattern.startsWith("*.") && wildcardMatches(r.pattern, h))
    .sort((a, b) => b.pattern.length - a.pattern.length)[0];
  return wild?.tier ?? policy.defaultTier;
}

/**
 * Tier each bridge method requires. Every dispatchable method MUST appear
 * here — the extension's dispatch gate looks methods up in this map, and an
 * unlisted method would bypass policy. The test pins the exact set.
 */
export const METHOD_TIERS = {
  list_tabs: "read",
  read_snapshot: "read",
  read_text: "read",
  screenshot: "read",
  read_console: "read",
  read_network: "read",
  wait_for: "read",
  navigate: "full",
  open_tab: "full",
  close_tab: "full",
  select_tab: "full",
  click: "full",
  type: "full",
  press_key: "full",
  hover: "full",
  scroll: "full",
  fill: "full",
  select_option: "full",
  upload: "full",
  resize: "full",
  handle_dialog: "full",
  eval_js: "full",
  cdp: "full",
} as const satisfies Record<string, Tier>;
export type GatedMethod = keyof typeof METHOD_TIERS;

const browserId = z.string().optional();

export const PolicyGetParams = z.object({ browserId });
export type PolicyGetParams = z.infer<typeof PolicyGetParams>;

/** `policy_tighten` may only lower a pattern's tier; the extension enforces it. */
export const PolicyTightenParams = z.object({
  browserId,
  pattern: z.string().min(1),
  tier: Tier,
});
export type PolicyTightenParams = z.infer<typeof PolicyTightenParams>;
