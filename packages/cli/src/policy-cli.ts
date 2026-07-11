import { effectiveTier, hostOf, Policy, type Tab } from "@reins/protocol";
import { parseArgs, UsageError } from "./args.js";

const USAGE = "usage: reins policy [deny|readonly|allow <pattern>] [--browser <id>]";

export interface PolicyDeps {
  rpc(method: string, params: Record<string, unknown>): Promise<unknown>;
}

/** Render `reins policy` output: default, rules, effective tier per tab host. */
export function policyText(policy: Policy, tabs: Tab[]): string {
  const lines = [`default: ${policy.defaultTier}`];
  if (policy.rules.length > 0) {
    lines.push("rules:");
    const w = Math.max(...policy.rules.map((r) => r.pattern.length)) + 2;
    for (const r of policy.rules) lines.push(`  ${r.pattern.padEnd(w)}${r.tier}`);
  }
  const hosts = [...new Set(tabs.map((t) => hostOf(t.url)).filter((h): h is string => !!h))];
  if (hosts.length > 0) {
    lines.push("open tabs:");
    const w = Math.max(...hosts.map((h) => h.length)) + 2;
    for (const h of hosts) lines.push(`  ${h.padEnd(w)}${effectiveTier(policy, h)}`);
  }
  const blocked = tabs.filter((t) => t.blocked === true).length;
  if (blocked > 0) {
    lines.push(`(${blocked} blocked tab${blocked === 1 ? "" : "s"} hidden by policy)`);
  }
  return lines.join("\n");
}

/** `reins policy …` — view and tighten only. Grants live in the popup. */
export async function runPolicy(argv: string[], deps: PolicyDeps): Promise<string> {
  const a = parseArgs(argv, {});
  const [sub, pattern] = a.positional;
  const browser = typeof a.flags.browser === "string" ? a.flags.browser : undefined;
  const route = browser !== undefined ? { browserId: browser } : {};

  if (sub === undefined) {
    const policy = Policy.parse(await deps.rpc("policy_get", { ...route }));
    const { tabs } = (await deps.rpc("list_tabs", { ...route })) as { tabs: Tab[] };
    return policyText(policy, tabs);
  }

  if (sub === "allow") {
    throw new Error(
      "grants require the extension popup — click the reins icon in the browser toolbar, then set the site's tier",
    );
  }

  const tier = sub === "deny" ? "deny" : sub === "readonly" ? "read" : undefined;
  if (tier === undefined) throw new UsageError(USAGE);
  if (pattern === undefined) throw new UsageError(`a pattern is required\n${USAGE}`);

  const next = Policy.parse(await deps.rpc("policy_tighten", { pattern, tier, ...route }));
  return `${pattern} → ${tier}\n${policyText(next, [])}`;
}
