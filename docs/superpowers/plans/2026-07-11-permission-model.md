# Permission Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Per-host permission tiers (`deny` < `read` < `full`) enforced inside the extension, with popup-only grants and a tighten-only `reins policy` CLI.

**Architecture:** Policy (default tier + host/wildcard rules) lives in `chrome.storage.local`; a gate in the extension's `dispatchMethod` resolves the target tab's host and refuses methods above the host's tier. Two new bridge methods (`policy_get`, `policy_tighten`) pass through the daemon untouched. The shared tier/matcher code lives in `@reins/protocol`.

**Tech Stack:** TypeScript, zod v4, vitest, pnpm workspace (packages: `protocol`, `extension`, `cli`). Extension is MV3 (service worker + offscreen doc).

**Spec:** `docs/superpowers/specs/2026-07-11-permission-model-design.md` — the authority on behavior.

## Global Constraints

- Shipped default policy: `{ defaultTier: "full", rules: [] }` (today's behavior).
- Grants (loosening) happen ONLY via the popup writing storage directly. `policy_tighten` must reject any non-strictly-tightening change.
- Matching precedence: exact host > longest matching wildcard > `defaultTier`. `*.foo.com` matches apex `foo.com` AND subdomains.
- Non-http(s) or unparseable tab URLs → `defaultTier`.
- Denied tabs in `list_tabs` are REDACTED (tabId + active kept, `title: ""`, `url: ""`, `blocked: true`), not omitted.
- Policy error text always names the host, its tier, and the popup remediation. Error `code` is `"policy_denied"` end-to-end (ResponseFrame `error.code`).
- After ANY change to `packages/protocol`, run `pnpm --filter @reins/protocol build` before running cli/extension tests (workspace imports resolve to `dist/`).
- Run tests per package: `pnpm --filter @karnstack/reins test`, `pnpm --filter @reins/extension test`, `pnpm --filter @reins/protocol test`. Typecheck: `pnpm -r typecheck`.
- Commit style: Conventional Commits, subject ≤ 50 chars, no AI attribution in body (trailer only).

---

### Task 1: `@reins/protocol` — tiers, matcher, method map, schemas

**Files:**
- Create: `packages/protocol/src/policy.ts`
- Create: `packages/protocol/src/policy.test.ts`
- Modify: `packages/protocol/src/bridge.ts` (add `blocked` to `Tab`)
- Modify: `packages/protocol/src/index.ts` (export)

**Interfaces:**
- Produces (used by every later task):
  - `Tier` (zod enum + type `"deny" | "read" | "full"`), `tighterThan(a: Tier, b: Tier): boolean`
  - `PolicyRule`, `Policy` (zod + types), `DEFAULT_POLICY: Policy`
  - `normalizePattern(input: string): string` (throws on invalid)
  - `hostOf(url: string): string | undefined`
  - `effectiveTier(policy: Policy, host: string | undefined): Tier`
  - `METHOD_TIERS` (`Record<method, Tier>` for all 23 dispatch methods), `type GatedMethod = keyof typeof METHOD_TIERS`
  - `PolicyGetParams`, `PolicyTightenParams` (zod + types)
  - `Tab` gains optional `blocked: boolean`

- [ ] **Step 1: Write the failing test**

Create `packages/protocol/src/policy.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  DEFAULT_POLICY,
  effectiveTier,
  hostOf,
  METHOD_TIERS,
  normalizePattern,
  Policy,
  tighterThan,
} from "./policy.js";

describe("tighterThan", () => {
  it("orders deny < read < full", () => {
    expect(tighterThan("deny", "read")).toBe(true);
    expect(tighterThan("read", "full")).toBe(true);
    expect(tighterThan("deny", "full")).toBe(true);
    expect(tighterThan("full", "read")).toBe(false);
    expect(tighterThan("read", "read")).toBe(false);
  });
});

describe("normalizePattern", () => {
  it("lowercases and strips scheme, port, path", () => {
    expect(normalizePattern("HTTPS://GitHub.com:443/foo")).toBe("github.com");
    expect(normalizePattern("localhost:3000")).toBe("localhost");
  });
  it("keeps a single leading wildcard", () => {
    expect(normalizePattern("*.Google.com")).toBe("*.google.com");
  });
  it.each(["foo.*.com", "*", "a b.com", "", "*.", "https://"])(
    "rejects %j",
    (bad) => expect(() => normalizePattern(bad)).toThrow(/invalid pattern/),
  );
});

describe("hostOf", () => {
  it("returns lowercase host for http(s)", () => {
    expect(hostOf("https://App.Example.com/x?y")).toBe("app.example.com");
    expect(hostOf("http://localhost:3000/")).toBe("localhost");
  });
  it("returns undefined for non-http(s) and garbage", () => {
    expect(hostOf("chrome://settings")).toBeUndefined();
    expect(hostOf("about:blank")).toBeUndefined();
    expect(hostOf("not a url")).toBeUndefined();
    expect(hostOf("")).toBeUndefined();
  });
});

describe("effectiveTier", () => {
  const policy: Policy = {
    defaultTier: "full",
    rules: [
      { pattern: "*.bank.com", tier: "deny" },
      { pattern: "app.bank.com", tier: "read" },
      { pattern: "*.corp.bank.com", tier: "read" },
      { pattern: "github.com", tier: "read" },
    ],
  };
  it("exact rule beats wildcard", () => {
    expect(effectiveTier(policy, "app.bank.com")).toBe("read");
  });
  it("longest wildcard wins", () => {
    expect(effectiveTier(policy, "x.corp.bank.com")).toBe("read");
    expect(effectiveTier(policy, "other.bank.com")).toBe("deny");
  });
  it("wildcard matches the apex", () => {
    expect(effectiveTier(policy, "bank.com")).toBe("deny");
  });
  it("falls back to defaultTier", () => {
    expect(effectiveTier(policy, "example.com")).toBe("full");
    expect(effectiveTier(policy, undefined)).toBe("full");
  });
  it("exact host rule does not match subdomains", () => {
    expect(effectiveTier(policy, "gist.github.com")).toBe("full");
  });
  it("DEFAULT_POLICY allows everything", () => {
    expect(effectiveTier(DEFAULT_POLICY, "anything.com")).toBe("full");
  });
});

describe("METHOD_TIERS", () => {
  it("classifies exactly the 23 bridge methods", () => {
    const read = [
      "list_tabs", "read_snapshot", "read_text", "screenshot",
      "read_console", "read_network", "wait_for",
    ];
    const full = [
      "navigate", "open_tab", "close_tab", "select_tab", "click", "type",
      "press_key", "hover", "scroll", "fill", "select_option", "upload",
      "resize", "handle_dialog", "eval_js", "cdp",
    ];
    for (const m of read) expect(METHOD_TIERS[m as keyof typeof METHOD_TIERS]).toBe("read");
    for (const m of full) expect(METHOD_TIERS[m as keyof typeof METHOD_TIERS]).toBe("full");
    expect(Object.keys(METHOD_TIERS)).toHaveLength(read.length + full.length);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @reins/protocol test -- policy`
Expected: FAIL — `Cannot find module './policy.js'`

- [ ] **Step 3: Write the implementation**

Create `packages/protocol/src/policy.ts`:

```ts
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
 *  unparseable input (chrome://, about:, …) — those get the default tier. */
export function hostOf(url: string): string | undefined {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return undefined;
    return u.hostname.toLowerCase();
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
```

In `packages/protocol/src/bridge.ts`, add `blocked` to `Tab` (after the
`active` field):

```ts
export const Tab = z.object({
  tabId: z.number(),
  title: z.string(),
  url: z.string(),
  active: z.boolean(),
  /** true when the tab's host is policy-denied: title/url are redacted. */
  blocked: z.boolean().optional(),
  browserId: z.string().optional(),
  browser: z.string().optional(),
});
```

In `packages/protocol/src/index.ts`, add:

```ts
export * from "./policy.js";
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @reins/protocol test && pnpm --filter @reins/protocol typecheck`
Expected: PASS (policy tests + existing bridge/cdp/frames/ports tests)

- [ ] **Step 5: Rebuild protocol dist**

Run: `pnpm --filter @reins/protocol build`
Expected: `dist/index.js` + `dist/index.d.ts` regenerate without error

- [ ] **Step 6: Commit**

```bash
git add packages/protocol/src/policy.ts packages/protocol/src/policy.test.ts packages/protocol/src/bridge.ts packages/protocol/src/index.ts
git commit -m "feat(protocol): add policy tiers, matcher, method map"
```

---

### Task 2: extension — policy store (load, cache, tighten, gate check)

**Files:**
- Create: `packages/extension/src/lib/policy.ts`
- Create: `packages/extension/src/lib/policy.test.ts`

**Interfaces:**
- Consumes (Task 1): `DEFAULT_POLICY`, `Policy`, `Tier`, `tighterThan`, `effectiveTier`, `normalizePattern`, `METHOD_TIERS`, `GatedMethod` from `@reins/protocol`.
- Produces (Tasks 3–4):
  - `POLICY_KEY = "reinsPolicy"` (storage key, shared with popup)
  - `class PolicyDenied extends Error { readonly code = "policy_denied" }`
  - `policy(): Promise<Policy>` — cached read (invalidated by `storage.onChanged`); throws on corrupt storage (fail closed)
  - `savePolicy(p: Policy): Promise<void>`
  - `tightenPolicy(patternInput: string, tier: Tier): Promise<Policy>` — throws `PolicyDenied` unless strictly tightening
  - `ensureAllowed(method: GatedMethod, host: string | undefined): Promise<void>` — throws `PolicyDenied`
  - `resetPolicyCacheForTests(): void`

- [ ] **Step 1: Write the failing test**

Create `packages/extension/src/lib/policy.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ensureAllowed,
  PolicyDenied,
  policy,
  resetPolicyCacheForTests,
  tightenPolicy,
} from "./policy.js";

type Listener = (changes: Record<string, unknown>, area: string) => void;

function stubStorage(initial?: unknown) {
  const store: Record<string, unknown> =
    initial === undefined ? {} : { reinsPolicy: initial };
  const listeners: Listener[] = [];
  vi.stubGlobal("chrome", {
    storage: {
      local: {
        get: async (key: string) => (key in store ? { [key]: store[key] } : {}),
        set: async (items: Record<string, unknown>) => {
          Object.assign(store, items);
          for (const l of listeners) l({ reinsPolicy: {} }, "local");
        },
      },
      onChanged: { addListener: (l: Listener) => listeners.push(l) },
    },
  });
  return store;
}

afterEach(() => {
  vi.unstubAllGlobals();
  resetPolicyCacheForTests();
});

describe("policy()", () => {
  it("defaults to full-everywhere when storage is empty", async () => {
    stubStorage();
    expect(await policy()).toEqual({ defaultTier: "full", rules: [] });
  });
  it("throws on corrupt storage (fail closed)", async () => {
    stubStorage({ defaultTier: "sideways", rules: "nope" });
    await expect(policy()).rejects.toThrow();
  });
  it("re-reads after a storage change (popup edit)", async () => {
    const store = stubStorage({ defaultTier: "full", rules: [] });
    expect((await policy()).rules).toHaveLength(0);
    store.reinsPolicy = {
      defaultTier: "full",
      rules: [{ pattern: "x.com", tier: "deny" }],
    };
    await chrome.storage.local.set({ poke: 1 }); // fires the listener
    expect((await policy()).rules).toHaveLength(1);
  });
});

describe("tightenPolicy", () => {
  it("adds a tightening rule and persists it", async () => {
    const store = stubStorage({ defaultTier: "full", rules: [] });
    const next = await tightenPolicy("GitHub.com", "read");
    expect(next.rules).toEqual([{ pattern: "github.com", tier: "read" }]);
    expect(store.reinsPolicy).toEqual(next);
  });
  it("tightens an existing rule in place", async () => {
    stubStorage({ defaultTier: "full", rules: [{ pattern: "x.com", tier: "read" }] });
    const next = await tightenPolicy("x.com", "deny");
    expect(next.rules).toEqual([{ pattern: "x.com", tier: "deny" }]);
  });
  it("rejects loosening an existing rule", async () => {
    stubStorage({ defaultTier: "full", rules: [{ pattern: "x.com", tier: "read" }] });
    await expect(tightenPolicy("x.com", "full")).rejects.toThrow(PolicyDenied);
  });
  it("rejects a no-op (equal tier)", async () => {
    stubStorage({ defaultTier: "read", rules: [] });
    await expect(tightenPolicy("x.com", "read")).rejects.toThrow(/already read/);
  });
  it("allows tightening below a covering wildcard", async () => {
    stubStorage({
      defaultTier: "read",
      rules: [{ pattern: "*.x.com", tier: "full" }],
    });
    const next = await tightenPolicy("a.x.com", "read");
    expect(next.rules).toContainEqual({ pattern: "a.x.com", tier: "read" });
  });
  it("rejects invalid patterns", async () => {
    stubStorage();
    await expect(tightenPolicy("foo.*.com", "deny")).rejects.toThrow(/invalid pattern/);
  });
});

describe("ensureAllowed", () => {
  it("full host allows read and full methods", async () => {
    stubStorage({ defaultTier: "full", rules: [] });
    await expect(ensureAllowed("click", "x.com")).resolves.toBeUndefined();
    await expect(ensureAllowed("read_text", "x.com")).resolves.toBeUndefined();
  });
  it("read host allows read, blocks full with popup hint", async () => {
    stubStorage({ defaultTier: "full", rules: [{ pattern: "x.com", tier: "read" }] });
    await expect(ensureAllowed("read_snapshot", "x.com")).resolves.toBeUndefined();
    await expect(ensureAllowed("click", "x.com")).rejects.toThrow(
      /x\.com is read-only.*popup/,
    );
  });
  it("deny host blocks everything", async () => {
    stubStorage({ defaultTier: "full", rules: [{ pattern: "*.bank.com", tier: "deny" }] });
    await expect(ensureAllowed("read_text", "app.bank.com")).rejects.toThrow(
      /app\.bank\.com is denied/,
    );
  });
  it("undefined host uses the default tier", async () => {
    stubStorage({ defaultTier: "read", rules: [] });
    await expect(ensureAllowed("screenshot", undefined)).resolves.toBeUndefined();
    await expect(ensureAllowed("eval_js", undefined)).rejects.toThrow(PolicyDenied);
  });
  it("carries code policy_denied", async () => {
    stubStorage({ defaultTier: "deny", rules: [] });
    const err = await ensureAllowed("click", "x.com").catch((e: unknown) => e);
    expect((err as { code?: string }).code).toBe("policy_denied");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @reins/extension test -- policy`
Expected: FAIL — `Cannot find module './policy.js'`

- [ ] **Step 3: Write the implementation**

Create `packages/extension/src/lib/policy.ts`:

```ts
import {
  DEFAULT_POLICY,
  effectiveTier,
  type GatedMethod,
  METHOD_TIERS,
  normalizePattern,
  Policy,
  type Tier,
  tighterThan,
} from "@reins/protocol";

/** chrome.storage.local key. The popup reads/writes the same key directly. */
export const POLICY_KEY = "reinsPolicy";

/** Refused by the policy gate. `code` survives to the ResponseFrame. */
export class PolicyDenied extends Error {
  readonly code = "policy_denied";
}

let cached: Policy | undefined;
let watching = false;

export function resetPolicyCacheForTests(): void {
  cached = undefined;
  watching = false;
}

/**
 * Current policy, cached in the worker; any reinsPolicy storage change
 * (popup edit, tighten) drops the cache. Corrupt storage throws — the
 * dispatch gate then refuses the request (fail closed), it never falls
 * back to full access.
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
 * Apply a strictly-tightening rule change. The comparison runs here, in the
 * extension — the daemon (any local process) cannot loosen policy. Grants
 * go through the popup, which writes storage directly.
 */
export async function tightenPolicy(patternInput: string, tier: Tier): Promise<Policy> {
  const pattern = normalizePattern(patternInput);
  const p = await policy();
  const existing = p.rules.find((r) => r.pattern === pattern);
  const current =
    existing?.tier ??
    effectiveTier(p, pattern.startsWith("*.") ? pattern.slice(2) : pattern);
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
}

/** Throw PolicyDenied unless `host`'s tier covers `method`'s required tier. */
export async function ensureAllowed(
  method: GatedMethod,
  host: string | undefined,
): Promise<void> {
  const tier = effectiveTier(await policy(), host);
  const required = METHOD_TIERS[method];
  if (tier === "full" || (tier === "read" && required === "read")) return;
  const label = host ?? "this tab";
  throw new PolicyDenied(
    tier === "deny"
      ? `blocked by policy: ${label} is denied — change its tier from the reins extension popup`
      : `blocked by policy: ${label} is read-only — grant full access from the reins extension popup`,
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @reins/extension test -- policy && pnpm --filter @reins/extension typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/extension/src/lib/policy.ts packages/extension/src/lib/policy.test.ts
git commit -m "feat(extension): policy store with tighten-only writes"
```

---

### Task 3: extension — dispatch gate, policy methods, redaction, error code

**Files:**
- Modify: `packages/extension/src/lib/dispatch.ts`
- Modify: `packages/extension/src/lib/dispatch.test.ts`
- Modify: `packages/extension/src/background.ts` (thread `code` through `reins:dispatch`)
- Modify: `packages/extension/src/offscreen.ts` (rehydrate `code` onto the thrown Error)
- Modify: `packages/extension/src/lib/bridge-client.ts` (use `err.code` in ResponseFrame)
- Modify: `packages/extension/src/lib/bridge-client.test.ts` (assert code passthrough)

**Interfaces:**
- Consumes (Tasks 1–2): `METHOD_TIERS`, `GatedMethod`, `hostOf`, `effectiveTier`, `PolicyTightenParams` from `@reins/protocol`; `ensureAllowed`, `policy`, `tightenPolicy` from `./policy.js`; `resolveTabId` from `./cdp.js` (existing, exported).
- Produces: `dispatchMethod` now also handles `"policy_get"` and `"policy_tighten"`; every gated method receives params with `tabId` pinned to the resolved tab; errors reaching the daemon carry `error.code === "policy_denied"` when the gate refused.

- [ ] **Step 1: Extend dispatch tests (failing)**

In `packages/extension/src/lib/dispatch.test.ts`:

1. Extend the `./cdp.js` mock with `resolveTabId` (the gate imports it):

```ts
vi.mock("./cdp.js", () => ({
  resolveTabId: vi.fn(async (tabId?: number) => tabId ?? 1),
  cdpNavigate: vi.fn(async () => ({ url: "https://x/" })),
  cdpSnapshot: vi.fn(async () => ({ content: "", refs: [] })),
  cdpClick: vi.fn(async () => ({ ok: true })),
  cdpType: vi.fn(async () => ({ ok: true })),
  cdpScreenshot: vi.fn(async () => ({ data: "abc123", mimeType: "image/png" })),
  cdpEval: vi.fn(async () => ({ value: 42 })),
  cdpWaitFor: vi.fn(async () => ({ ok: true })),
}));
```

2. Mock `./policy.js` so existing routing tests keep passing (allow-all), and
   capture calls:

```ts
vi.mock("./policy.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("./policy.js")>();
  return {
    ...real,
    policy: vi.fn(async () => ({ defaultTier: "full", rules: [] })),
    ensureAllowed: vi.fn(async () => undefined),
    tightenPolicy: vi.fn(async (pattern: string, tier: string) => ({
      defaultTier: "full",
      rules: [{ pattern, tier }],
    })),
  };
});
```

Import the mocks at the top of the file:

```ts
import { ensureAllowed, PolicyDenied, policy, tightenPolicy } from "./policy.js";
```

3. Existing routing tests that hit tab-scoped methods now need a `chrome`
   stub with `tabs.get` (the gate resolves the host). Add a helper and use it
   in the `routes navigate/click/...` tests:

```ts
function stubTabs(url = "https://x.com/") {
  vi.stubGlobal("chrome", {
    tabs: {
      get: async (id: number) => ({ id, url }),
      query: async () => [{ id: 1, title: "t", url, active: true }],
      create: async () => ({ id: 11 }),
      remove: async () => undefined,
      update: async () => ({}),
    },
    windows: { update: async () => ({}) },
  });
}
```

Call `stubTabs()` at the start of each routing test that previously ran
without a chrome stub (the CDP/page-actions/monitor routing tests), and keep
per-test overrides where the test already installs its own stub — merging
`tabs.get` into those (`close_tab`, `select_tab`, `resize`, `open_tab`
gains nothing: it is destination-checked, not tab-resolved).

4. New test blocks:

```ts
describe("policy gate", () => {
  it("checks the resolved tab's host for tab-scoped methods", async () => {
    stubTabs("https://app.example.com/page");
    await dispatchMethod("click", { ref: "e1" });
    expect(ensureAllowed).toHaveBeenCalledWith("click", "app.example.com");
  });

  it("pins the resolved tabId into handler params", async () => {
    stubTabs();
    const { cdpClick } = await import("./cdp.js");
    await dispatchMethod("click", { ref: "e1" });
    expect(cdpClick).toHaveBeenCalledWith(expect.objectContaining({ tabId: 1 }));
  });

  it("checks the destination host for open_tab", async () => {
    stubTabs();
    await dispatchMethod("open_tab", { url: "https://new.site/x", activate: true });
    expect(ensureAllowed).toHaveBeenCalledWith("open_tab", "new.site");
  });

  it("checks current AND destination hosts for navigate", async () => {
    stubTabs("https://here.com/");
    await dispatchMethod("navigate", { to: "https://there.com/x" });
    expect(ensureAllowed).toHaveBeenCalledWith("navigate", "here.com");
    expect(ensureAllowed).toHaveBeenCalledWith("navigate", "there.com");
  });

  it("checks only the current host for back/forward/reload", async () => {
    stubTabs("https://here.com/");
    await dispatchMethod("navigate", { to: "back" });
    expect(ensureAllowed).toHaveBeenCalledTimes(1);
    expect(ensureAllowed).toHaveBeenCalledWith("navigate", "here.com");
  });

  it("propagates PolicyDenied from the gate", async () => {
    stubTabs();
    vi.mocked(ensureAllowed).mockRejectedValueOnce(
      new PolicyDenied("blocked by policy: x.com is read-only"),
    );
    await expect(dispatchMethod("click", { ref: "e1" })).rejects.toThrow(/blocked by policy/);
  });
});

describe("list_tabs redaction", () => {
  it("redacts denied tabs, passes others through", async () => {
    vi.stubGlobal("chrome", {
      tabs: {
        query: async () => [
          { id: 1, title: "Bank", url: "https://app.bank.com/x", active: true },
          { id: 2, title: "Docs", url: "https://docs.example.com", active: false },
        ],
      },
    });
    vi.mocked(policy).mockResolvedValueOnce({
      defaultTier: "full",
      rules: [{ pattern: "*.bank.com", tier: "deny" }],
    });
    expect(await dispatchMethod("list_tabs", {})).toEqual({
      tabs: [
        { tabId: 1, title: "", url: "", active: true, blocked: true },
        { tabId: 2, title: "Docs", url: "https://docs.example.com", active: false },
      ],
    });
  });
});

describe("policy methods", () => {
  it("policy_get returns the policy", async () => {
    expect(await dispatchMethod("policy_get", {})).toEqual({
      defaultTier: "full",
      rules: [],
    });
  });
  it("policy_tighten validates params and delegates", async () => {
    expect(await dispatchMethod("policy_tighten", { pattern: "x.com", tier: "read" }))
      .toEqual({ defaultTier: "full", rules: [{ pattern: "x.com", tier: "read" }] });
    expect(tightenPolicy).toHaveBeenCalledWith("x.com", "read");
  });
  it("policy_tighten rejects a bad tier", async () => {
    await expect(
      dispatchMethod("policy_tighten", { pattern: "x.com", tier: "sideways" }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `pnpm --filter @reins/extension test -- dispatch`
Expected: new tests FAIL (`ensureAllowed` never called, `policy_get` hits
"unknown method"); pre-existing routing tests may also fail until Step 3.

- [ ] **Step 3: Implement the gate in `dispatch.ts`**

Replace the imports/top of `packages/extension/src/lib/dispatch.ts` and wrap
the switch:

```ts
import {
  effectiveTier,
  type GatedMethod,
  hostOf,
  METHOD_TIERS,
  PolicyTightenParams,
} from "@reins/protocol";
import {
  cdpClick,
  cdpEval,
  cdpNavigate,
  cdpScreenshot,
  cdpSnapshot,
  cdpType,
  cdpWaitFor,
  resolveTabId,
} from "./cdp.js";
import { readConsole, readNetwork } from "./monitor.js";
import {
  cdpRaw,
  fill,
  handleDialog,
  hover,
  pressKey,
  readText,
  scroll,
  selectOption,
  upload,
} from "./page-actions.js";
import { ensureAllowed, policy, tightenPolicy } from "./policy.js";
import { closeTab, listTabs, openTab, resizeWindow, selectTab } from "./tab-handler.js";

const NAV_HISTORY = new Set(["back", "forward", "reload"]);

/**
 * Policy gate. Resolves the target tab once (so gate and handler agree),
 * checks the host's tier against the method's required tier, and returns
 * params with tabId pinned. list_tabs is gated per-tab (redaction) in the
 * switch below; open_tab has no current tab and checks its destination.
 */
async function gate(
  method: GatedMethod,
  params: unknown,
): Promise<Record<string, unknown>> {
  const p = { ...((params ?? {}) as Record<string, unknown>) };
  if (method === "list_tabs") return p;
  if (method === "open_tab") {
    await ensureAllowed("open_tab", hostOf(String(p.url ?? "")));
    return p;
  }
  const tabId = await resolveTabId(typeof p.tabId === "number" ? p.tabId : undefined);
  const tab = await chrome.tabs.get(tabId);
  await ensureAllowed(method, hostOf(tab.url ?? ""));
  if (method === "navigate") {
    const to = String(p.to ?? "");
    const dest = NAV_HISTORY.has(to) ? undefined : hostOf(to);
    if (dest !== undefined) await ensureAllowed("navigate", dest);
  }
  return { ...p, tabId };
}

/**
 * Route an incoming bridge method name to the appropriate browser handler.
 * Add new cases here as more bridge methods are implemented — and classify
 * the method in METHOD_TIERS (@reins/protocol), or the gate refuses it.
 */
export async function dispatchMethod(method: string, params: unknown): Promise<unknown> {
  if (method === "policy_get") return policy();
  if (method === "policy_tighten") {
    const { pattern, tier } = PolicyTightenParams.parse(params ?? {});
    return tightenPolicy(pattern, tier);
  }
  if (!(method in METHOD_TIERS)) throw new Error(`unknown method: ${method}`);
  const gated = await gate(method as GatedMethod, params);

  switch (method) {
    case "list_tabs": {
      const { tabs } = await listTabs();
      const pol = await policy();
      return {
        tabs: tabs.map((t) =>
          effectiveTier(pol, hostOf(t.url)) === "deny"
            ? { tabId: t.tabId, title: "", url: "", active: t.active, blocked: true }
            : t,
        ),
      };
    }
    case "open_tab":
      return openTab(gated as Parameters<typeof openTab>[0]);
    case "close_tab":
      return closeTab(gated as Parameters<typeof closeTab>[0]);
    // …every remaining case identical to today, but passing `gated`
    // instead of `params`, e.g.:
    case "navigate":
      return cdpNavigate(gated as Parameters<typeof cdpNavigate>[0]);
    case "click":
      return cdpClick(gated as Parameters<typeof cdpClick>[0]);
    /* read_snapshot, type, screenshot, eval_js, wait_for, read_console,
       read_network, press_key, hover, scroll, fill, select_option, upload,
       read_text, resize, handle_dialog, cdp — same mechanical change. */
    default:
      throw new Error(`unknown method: ${method}`);
  }
}
```

(The `default` branch is now unreachable for real methods — kept as a
safety net. Every `case` body changes `params` → `gated`; nothing else.)

- [ ] **Step 4: Thread the error code across the offscreen relay**

`packages/extension/src/background.ts`, in the `reins:dispatch` case:

```ts
case "reins:dispatch": {
  const method = message.method as string;
  const params = message.params;
  dispatchMethod(method, params)
    .then((result) => sendResponse({ result }))
    .catch((err) =>
      sendResponse({
        error: err instanceof Error ? err.message : String(err),
        code: typeof (err as { code?: unknown })?.code === "string"
          ? (err as { code: string }).code
          : undefined,
      }),
    );
  return true;
}
```

`packages/extension/src/offscreen.ts`, `offscreenDispatch`:

```ts
async function offscreenDispatch(method: string, params: unknown): Promise<unknown> {
  const res = (await chrome.runtime.sendMessage({ type: "reins:dispatch", method, params })) as
    | { result: unknown; error?: undefined; code?: undefined }
    | { error: string; code?: string; result?: undefined }
    | undefined;
  if (res?.error) {
    const err = new Error(res.error) as Error & { code?: string };
    if (res.code) err.code = res.code;
    throw err;
  }
  return res?.result;
}
```

`packages/extension/src/lib/bridge-client.ts`, in `#handleRequest`'s error
branch:

```ts
const code =
  typeof (dispatchError as { code?: unknown })?.code === "string"
    ? ((dispatchError as { code: string }).code)
    : "HANDLER_ERROR";
socket.send(
  JSON.stringify({ type: "response", id, ok: false, error: { code, message } }),
);
```

Add to `packages/extension/src/lib/bridge-client.test.ts` (inside the
existing describe, following the file's established harness pattern for a
connected client — reuse its helpers):

```ts
it("uses err.code in the error frame when present", async () => {
  // dispatch throws an Error carrying code "policy_denied"
  // assert the sent response frame is
  // { type: "response", id, ok: false, error: { code: "policy_denied", message: "nope" } }
});
```

Implement the body with the file's existing fake-socket helpers (the test
above `sends HANDLER_ERROR responses` is the template: copy it, make the
dispatch mock throw `Object.assign(new Error("nope"), { code: "policy_denied" })`,
and assert `error.code === "policy_denied"`).

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @reins/extension test && pnpm --filter @reins/extension typecheck`
Expected: PASS (all dispatch + bridge-client + policy + existing tests)

- [ ] **Step 6: Commit**

```bash
git add packages/extension/src
git commit -m "feat(extension): enforce policy in dispatch gate"
```

---

### Task 4: popup — Site permissions section

**Files:**
- Modify: `packages/extension/src/popup.html`
- Modify: `packages/extension/src/popup.ts`
- Modify: `packages/extension/src/popup.css`
- Create: `packages/extension/src/lib/policy-view.ts`
- Create: `packages/extension/src/lib/policy-view.test.ts`

**Interfaces:**
- Consumes (Tasks 1–2): `DEFAULT_POLICY`, `Policy`, `Tier`, `effectiveTier`, `hostOf`, `normalizePattern` from `@reins/protocol`; `POLICY_KEY` from `./lib/policy.js`.
- Produces: pure helpers in `policy-view.ts` (tested); popup wiring (untested, minimal):
  - `upsertRule(p: Policy, pattern: string, tier: Tier): Policy`
  - `removeRule(p: Policy, pattern: string): Policy`
  - `setDefaultTier(p: Policy, tier: Tier): Policy`

The popup is the ONLY loosening surface — it writes `chrome.storage.local`
directly (a user gesture). No tighten-only restriction here.

- [ ] **Step 1: Write the failing test**

Create `packages/extension/src/lib/policy-view.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Policy } from "@reins/protocol";
import { removeRule, setDefaultTier, upsertRule } from "./policy-view.js";

const base: Policy = { defaultTier: "full", rules: [{ pattern: "x.com", tier: "read" }] };

describe("upsertRule", () => {
  it("adds a normalized rule", () => {
    const next = upsertRule(base, "*.New.com", "deny");
    expect(next.rules).toContainEqual({ pattern: "*.new.com", tier: "deny" });
  });
  it("replaces an existing rule (either direction — popup may loosen)", () => {
    expect(upsertRule(base, "x.com", "full").rules).toEqual([
      { pattern: "x.com", tier: "full" },
    ]);
  });
  it("does not mutate the input", () => {
    upsertRule(base, "y.com", "deny");
    expect(base.rules).toHaveLength(1);
  });
});

describe("removeRule", () => {
  it("removes by pattern", () => {
    expect(removeRule(base, "x.com").rules).toEqual([]);
  });
});

describe("setDefaultTier", () => {
  it("replaces defaultTier only", () => {
    expect(setDefaultTier(base, "read")).toEqual({ ...base, defaultTier: "read" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @reins/extension test -- policy-view`
Expected: FAIL — `Cannot find module './policy-view.js'`

- [ ] **Step 3: Implement helpers**

Create `packages/extension/src/lib/policy-view.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @reins/extension test -- policy-view`
Expected: PASS

- [ ] **Step 5: Add the popup section**

In `packages/extension/src/popup.html`, insert between the Disconnect button
and the `<details class="reins__advanced">` block:

```html
<section class="reins__policy">
  <h2 class="reins__policy-title">Site permissions</h2>

  <div class="reins__policy-current" id="policy-current" hidden>
    <span class="reins__policy-host" id="policy-host">—</span>
    <div class="reins__seg" id="policy-current-seg" role="group" aria-label="Tier for this site">
      <button type="button" data-tier="full">Full</button>
      <button type="button" data-tier="read">Read</button>
      <button type="button" data-tier="deny">Deny</button>
    </div>
  </div>

  <div class="reins__field">
    <label class="reins__label" for="policy-default">Default for other sites</label>
    <select class="reins__input" id="policy-default">
      <option value="full">Full access</option>
      <option value="read">Read-only</option>
      <option value="deny">Deny</option>
    </select>
  </div>

  <ul class="reins__policy-rules" id="policy-rules"></ul>

  <form class="reins__policy-add" id="policy-add">
    <input class="reins__input reins__input--mono" id="policy-pattern"
           placeholder="*.example.com" autocomplete="off" />
    <select class="reins__input" id="policy-add-tier">
      <option value="deny">Deny</option>
      <option value="read">Read-only</option>
      <option value="full">Full</option>
    </select>
    <button class="reins__btn reins__btn--ghost" type="submit">Add</button>
  </form>
</section>
```

In `packages/extension/src/popup.ts`, append (new imports at top):

```ts
import { DEFAULT_POLICY, effectiveTier, hostOf, Policy, type Tier } from "@reins/protocol";
import { POLICY_KEY } from "./lib/policy.js";
import { removeRule, setDefaultTier, upsertRule } from "./lib/policy-view.js";

const policyCurrent = document.getElementById("policy-current") as HTMLElement;
const policyHost = document.getElementById("policy-host") as HTMLElement;
const policySeg = document.getElementById("policy-current-seg") as HTMLElement;
const policyDefault = document.getElementById("policy-default") as HTMLSelectElement;
const policyRules = document.getElementById("policy-rules") as HTMLUListElement;
const policyAdd = document.getElementById("policy-add") as HTMLFormElement;
const policyPattern = document.getElementById("policy-pattern") as HTMLInputElement;
const policyAddTier = document.getElementById("policy-add-tier") as HTMLSelectElement;

async function loadPolicyFromStorage(): Promise<Policy> {
  try {
    const got = await chrome.storage.local.get(POLICY_KEY);
    return got[POLICY_KEY] === undefined ? DEFAULT_POLICY : Policy.parse(got[POLICY_KEY]);
  } catch {
    return DEFAULT_POLICY;
  }
}

async function writePolicy(p: Policy): Promise<void> {
  await chrome.storage.local.set({ [POLICY_KEY]: p });
  await renderPolicy();
}

async function activeHost(): Promise<string | undefined> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return hostOf(tab?.url ?? "");
  } catch {
    return undefined;
  }
}

async function renderPolicy(): Promise<void> {
  const p = await loadPolicyFromStorage();
  const host = await activeHost();

  policyDefault.value = p.defaultTier;

  policyCurrent.hidden = host === undefined;
  if (host !== undefined) {
    policyHost.textContent = host;
    const tier = effectiveTier(p, host);
    for (const btn of policySeg.querySelectorAll<HTMLButtonElement>("button")) {
      btn.classList.toggle("reins__seg--on", btn.dataset.tier === tier);
    }
  }

  policyRules.replaceChildren(
    ...p.rules.map((r) => {
      const li = document.createElement("li");
      li.className = "reins__policy-rule";
      const label = document.createElement("code");
      label.textContent = `${r.pattern} · ${r.tier}`;
      const del = document.createElement("button");
      del.type = "button";
      del.className = "reins__policy-del";
      del.textContent = "×";
      del.setAttribute("aria-label", `remove rule for ${r.pattern}`);
      del.addEventListener("click", () => {
        void loadPolicyFromStorage().then((cur) => writePolicy(removeRule(cur, r.pattern)));
      });
      li.append(label, del);
      return li;
    }),
  );
}

policySeg.addEventListener("click", (ev) => {
  const tier = (ev.target as HTMLElement).dataset?.tier as Tier | undefined;
  if (!tier) return;
  void (async () => {
    const host = await activeHost();
    if (host === undefined) return;
    await writePolicy(upsertRule(await loadPolicyFromStorage(), host, tier));
  })();
});

policyDefault.addEventListener("change", () => {
  void loadPolicyFromStorage().then((p) =>
    writePolicy(setDefaultTier(p, policyDefault.value as Tier)),
  );
});

policyAdd.addEventListener("submit", (ev) => {
  ev.preventDefault();
  void (async () => {
    try {
      const p = await loadPolicyFromStorage();
      await writePolicy(upsertRule(p, policyPattern.value, policyAddTier.value as Tier));
      policyPattern.value = "";
      policyPattern.setCustomValidity("");
    } catch {
      policyPattern.setCustomValidity("use host.com or *.host.com");
      policyAdd.reportValidity();
    }
  })();
});

void renderPolicy();
```

In `packages/extension/src/popup.css`, append (follow the file's existing
custom-property palette — read it first and reuse its variables for colors,
radii, spacing):

```css
.reins__policy { display: grid; gap: 8px; }
.reins__policy-title { font-size: 12px; margin: 0; opacity: 0.7; text-transform: uppercase; letter-spacing: 0.04em; }
.reins__policy-current { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.reins__policy-host { font-family: ui-monospace, monospace; font-size: 12px; overflow: hidden; text-overflow: ellipsis; }
.reins__seg { display: inline-flex; border: 1px solid currentColor; border-radius: 6px; overflow: hidden; }
.reins__seg button { border: 0; background: transparent; padding: 4px 8px; font: inherit; cursor: pointer; }
.reins__seg--on { background: currentColor; }
.reins__seg .reins__seg--on { color: Canvas; }
.reins__policy-rules { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
.reins__policy-rule { display: flex; justify-content: space-between; align-items: center; font-size: 12px; }
.reins__policy-del { border: 0; background: transparent; cursor: pointer; font: inherit; opacity: 0.6; }
.reins__policy-add { display: flex; gap: 4px; }
.reins__policy-add input { flex: 1; min-width: 0; }
```

- [ ] **Step 6: Build + manual smoke**

Run: `pnpm --filter @reins/extension build && pnpm --filter @reins/extension typecheck`
Expected: vite build succeeds.

Manual check (deferred to the branch-level verify pass if no browser at
hand): load the unpacked build, open the popup on a normal site — host row
shows, tier toggles persist across popup reopen, add/remove rules works,
default selector persists.

- [ ] **Step 7: Commit**

```bash
git add packages/extension/src/popup.html packages/extension/src/popup.ts packages/extension/src/popup.css packages/extension/src/lib/policy-view.ts packages/extension/src/lib/policy-view.test.ts
git commit -m "feat(extension): site permissions popup section"
```

---

### Task 5: CLI — `reins policy` (view + tighten only)

**Files:**
- Create: `packages/cli/src/policy-cli.ts`
- Create: `packages/cli/src/policy-cli.test.ts`
- Modify: `packages/cli/src/cli.ts` (add `policy` case; export nothing new)
- Modify: `packages/cli/src/cli-commands.ts` (help text: add `policy` under Management)

**Interfaces:**
- Consumes: `Policy`, `Tab`, `effectiveTier`, `hostOf` from `@reins/protocol`; `UsageError` from `./args.js`.
- Produces:
  - `policyText(policy: Policy, tabs: Tab[]): string`
  - `runPolicy(argv: string[], deps: { rpc(method: string, params: Record<string, unknown>): Promise<unknown> }): Promise<string>` — returns the line(s) to print; throws `UsageError`/`Error` otherwise.
  - cli.ts wires `deps.rpc` to the existing `ensureDaemon` + local `rpc` helper.

Subcommands: `reins policy` (show), `reins policy deny <pattern>`,
`reins policy readonly <pattern>`, `reins policy allow <pattern>` (always an
error explaining popup grants). Optional `--browser <id>` on all.

- [ ] **Step 1: Write the failing test**

Create `packages/cli/src/policy-cli.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import type { Policy } from "@reins/protocol";
import { policyText, runPolicy } from "./policy-cli.js";

const POLICY: Policy = {
  defaultTier: "full",
  rules: [
    { pattern: "*.bank.com", tier: "deny" },
    { pattern: "github.com", tier: "read" },
  ],
};

describe("policyText", () => {
  it("shows default, rules, and effective tier per open-tab host", () => {
    const text = policyText(POLICY, [
      { tabId: 1, title: "gh", url: "https://github.com/a", active: true },
      { tabId: 2, title: "", url: "", active: false, blocked: true },
      { tabId: 3, title: "x", url: "https://x.com/", active: false },
    ]);
    expect(text).toContain("default: full");
    expect(text).toContain("*.bank.com");
    expect(text).toMatch(/github\.com\s+read/);
    expect(text).toMatch(/x\.com\s+full/);
    expect(text).toContain("1 blocked tab");
  });
});

describe("runPolicy", () => {
  it("show: calls policy_get + list_tabs", async () => {
    const rpc = vi.fn(async (method: string) =>
      method === "policy_get" ? POLICY : { tabs: [] },
    );
    const out = await runPolicy([], { rpc });
    expect(rpc).toHaveBeenCalledWith("policy_get", {});
    expect(rpc).toHaveBeenCalledWith("list_tabs", {});
    expect(out).toContain("default: full");
  });

  it("deny: tightens via policy_tighten", async () => {
    const rpc = vi.fn(async () => ({ defaultTier: "full", rules: [] }));
    const out = await runPolicy(["deny", "evil.com"], { rpc });
    expect(rpc).toHaveBeenCalledWith("policy_tighten", { pattern: "evil.com", tier: "deny" });
    expect(out).toContain("evil.com");
  });

  it("readonly maps to tier read", async () => {
    const rpc = vi.fn(async () => ({ defaultTier: "full", rules: [] }));
    await runPolicy(["readonly", "*.corp.com"], { rpc });
    expect(rpc).toHaveBeenCalledWith("policy_tighten", { pattern: "*.corp.com", tier: "read" });
  });

  it("passes --browser through", async () => {
    const rpc = vi.fn(async () => ({ defaultTier: "full", rules: [] }));
    await runPolicy(["deny", "evil.com", "--browser", "b2"], { rpc });
    expect(rpc).toHaveBeenCalledWith("policy_tighten", {
      pattern: "evil.com",
      tier: "deny",
      browserId: "b2",
    });
  });

  it("allow: never calls rpc, explains the popup", async () => {
    const rpc = vi.fn();
    await expect(runPolicy(["allow", "x.com"], { rpc })).rejects.toThrow(
      /grants require the extension popup/,
    );
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects unknown subcommands and missing patterns", async () => {
    const rpc = vi.fn();
    await expect(runPolicy(["frobnicate"], { rpc })).rejects.toThrow(/usage/i);
    await expect(runPolicy(["deny"], { rpc })).rejects.toThrow(/pattern/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @karnstack/reins test -- policy-cli`
Expected: FAIL — `Cannot find module './policy-cli.js'`

- [ ] **Step 3: Implement**

Create `packages/cli/src/policy-cli.ts`:

```ts
import { effectiveTier, hostOf, Policy, type Tab } from "@reins/protocol";
import { parseArgs, UsageError } from "./args.js";

const USAGE =
  "usage: reins policy [deny|readonly|allow <pattern>] [--browser <id>]";

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

  const next = Policy.parse(
    await deps.rpc("policy_tighten", { pattern, tier, ...route }),
  );
  return `${pattern} → ${tier}\n${policyText(next, [])}`;
}
```

In `packages/cli/src/cli.ts`, add a case to the switch (before `default`),
reusing the module's `rpc` helper and daemon bootstrap:

```ts
case "policy": {
  const { runPolicy } = await import("./policy-cli.js");
  const ensured = await ensureDaemon(loadOrCreateConfig());
  if (ensured.health.browsers.length === 0) {
    if (!ensured.spawned) {
      throw new Error(
        "no browser connected — is the reins extension installed? (`reins status`)",
      );
    }
    await waitForBrowsers(ensured.port);
  }
  console.log(
    await runPolicy(rest, {
      rpc: (method, params) => rpc(ensured.port, method, params),
    }),
  );
  break;
}
```

In `packages/cli/src/cli-commands.ts` `helpText`, add to the Management
block (after the `browsers` line):

```ts
line("policy", "site permissions: show, deny/readonly <pattern> (grants: popup)"),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @karnstack/reins test -- policy-cli && pnpm --filter @karnstack/reins typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/policy-cli.ts packages/cli/src/policy-cli.test.ts packages/cli/src/cli.ts packages/cli/src/cli-commands.ts
git commit -m "feat(cli): add reins policy (view + tighten only)"
```

---

### Task 6: integration test — policy flows over the real bridge

**Files:**
- Modify: `packages/cli/src/integration.test.ts`

**Interfaces:**
- Consumes: existing harness (`setupHarness`, `standInExtension`, `rpc`). The stand-in extension is a lookup table today; it gains two entries and one error case.

- [ ] **Step 1: Extend the stand-in + add failing tests**

In `packages/cli/src/integration.test.ts`:

1. Add to `METHOD_RESULTS`:

```ts
policy_get: { defaultTier: "full", rules: [] },
policy_tighten: {
  defaultTier: "full",
  rules: [{ pattern: "evil.com", tier: "deny" }],
},
```

2. Teach the stand-in to return an error frame for a magic marker (mirrors
   the real extension refusing a gated method). Replace the `request`
   branch of `standInExtension`:

```ts
if (msg.type === "request") {
  if (msg.method === "click" && DENY_CLICKS) {
    ws.send(
      JSON.stringify({
        type: "response",
        id: msg.id,
        ok: false,
        error: {
          code: "policy_denied",
          message:
            "blocked by policy: x.com is read-only — grant full access from the reins extension popup",
        },
      }),
    );
    return;
  }
  const result = METHOD_RESULTS[msg.method ?? ""];
  ws.send(JSON.stringify({ type: "response", id: msg.id, ok: true, result }));
}
```

with a module-level `let DENY_CLICKS = false;` reset in `afterEach`.

3. New tests after the existing describe:

```ts
describe("policy over the bridge", () => {
  it("routes policy_get and policy_tighten end-to-end", async () => {
    const port = await setupHarness();
    expect(await rpc(port, "policy_get")).toEqual({ defaultTier: "full", rules: [] });
    expect(await rpc(port, "policy_tighten", { pattern: "evil.com", tier: "deny" })).toEqual({
      defaultTier: "full",
      rules: [{ pattern: "evil.com", tier: "deny" }],
    });
  });

  it("surfaces policy_denied to the HTTP caller", async () => {
    const port = await setupHarness();
    DENY_CLICKS = true;
    const res = await fetch(`http://127.0.0.1:${port}/rpc`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ method: "click", params: { ref: "e1" } }),
    });
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/blocked by policy/);
    expect(body.error).toMatch(/popup/);
    // read-tier methods still work in the same session
    expect(await rpc(port, "read_text")).toEqual({ text: "page text" });
  });
});
```

- [ ] **Step 2: Run to verify the new tests fail, then fix expectations**

Run: `pnpm --filter @reins/protocol build && pnpm --filter @karnstack/reins test -- integration`
Expected: the two new tests fail before the stand-in edits are saved; all
pass after. If the daemon's error mapping wraps the message differently
(check `packages/cli/src/daemon.ts:89` and `bridge.ts`'s request rejection),
adjust the `body.error` assertions to the actual wrapped text — the
requirement is that "blocked by policy" and "popup" survive to the CLI
caller verbatim.

- [ ] **Step 3: Commit**

```bash
git add packages/cli/src/integration.test.ts
git commit -m "test(cli): cover policy methods and denial end-to-end"
```

---

### Task 7: docs + changeset

**Files:**
- Modify: `skills/reins/SKILL.md` (gotcha entry)
- Modify: `README.md` (short security paragraph)
- Create: `.changeset/permission-model.md`

- [ ] **Step 1: SKILL.md gotcha**

Read `skills/reins/SKILL.md`, find the gotchas section, add one entry
matching its list style:

```markdown
- Commands can fail with `blocked by policy: <host> is read-only/denied`.
  The user's site-permission policy blocks that action tier. Do not retry
  and do not try to change the policy yourself — `reins policy` can only
  view or tighten. Tell the user which host and tier blocked you and that
  grants live in the reins extension popup (toolbar icon → Site
  permissions).
```

- [ ] **Step 2: README security paragraph**

Read `README.md`, add under the existing security-adjacent section (or
after the feature list if none):

```markdown
### Site permissions

reins enforces a per-site policy inside the extension: every host resolves
to a tier — `deny`, `read` (observation only: tabs/text/snapshot/
screenshot/console/network), or `full`. Fresh installs default to `full`
everywhere (zero-config); tighten it with `reins policy deny <host>` /
`reins policy readonly <host>` or from the extension popup. Loosening is
popup-only by design — a shell agent cannot grant itself access, because
the check runs in the extension, not the daemon.
```

- [ ] **Step 3: Changeset**

Create `.changeset/permission-model.md` (cli gets minor; extension version
bumps via its own release flow — include it if the repo's existing
changesets do):

```markdown
---
"@karnstack/reins": minor
---

Per-site permission tiers (deny/read/full) enforced in the extension.
`reins policy` shows and tightens policy; grants are popup-only. New
bridge methods `policy_get`/`policy_tighten`; denied tabs are redacted in
`list_tabs`. Default remains full access everywhere.
```

Check `git log`'s previous `Version Packages` PRs / existing `.changeset/*`
conventions first; mirror how `@reins/extension` bumps are declared (it is
`private: true`, so it is likely excluded — confirm against
`.changeset/config.json`).

- [ ] **Step 4: Full verification sweep**

```bash
pnpm --filter @reins/protocol build
pnpm -r typecheck
pnpm -r test
pnpm --filter @reins/extension build
```

Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add skills/reins/SKILL.md README.md .changeset/permission-model.md
git commit -m "docs: site permissions gotcha, README, changeset"
```

---

## After the plan: PR + review (session workflow, not plan tasks)

1. Push `feat/permission-model`, open PR against `main` titled
   `feat: per-site permission tiers (deny/read/full)` — body summarizes the
   spec, links `docs/superpowers/specs/2026-07-11-permission-model-design.md`.
2. Run `/code-review` via a Fable subagent on the PR diff; triage and fix
   confirmed findings before merge.
