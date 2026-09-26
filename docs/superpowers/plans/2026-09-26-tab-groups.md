# Tab Groups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the agent tab-group primitives (`reins groups`, `reins group`, `reins ungroup`, and `groupId` in `reins tabs`) so it can mark and organize tabs. reins never groups anything on its own.

**Architecture:** Each command follows the existing pipeline. First, zod schemas and `METHOD_TIERS` in `@reins/protocol`. Next, a handler in the extension (new `tab-groups.ts`) behind the `dispatch.ts` policy gate. Then daemon routing and aggregation (`rpc.ts`), and finally a CLI `ToolCommand` (`commands.ts`). Browsers without `chrome.tabGroups` answer with error code `unsupported`.

**Tech Stack:** TypeScript, zod, vitest, pnpm + turbo monorepo, Chrome MV3 extension (`@types/chrome` 0.2.0), biome.

**Spec:** `docs/superpowers/specs/2026-09-26-tab-groups-design.md`

## Global Constraints

- The four group methods (`list_groups`, `group_tabs`, `update_group`, `ungroup_tabs`) are all tier `"read"`.
- Colors are exactly: grey, blue, red, yellow, green, pink, purple, cyan, orange.
- Unsupported browser → `Error` with `code = "unsupported"`, message `this browser doesn't support tab groups (chrome.tabGroups unavailable)`.
- `ungroup` never closes tabs.
- No auto-grouping and no settings toggle.
- Manual e2e only touches tabs reins opened itself (see memory: never mutate the user's browser-wide state).
- Rebuild `@reins/protocol` (`pnpm --filter @reins/protocol build`) before running cli or extension tests. They import its `dist`.
- Two stacked PRs:
  - PR1 is branch `feat/tab-groups`, Tasks 1–4.
  - PR2 is branch `feat/tab-groups-write`, cut from PR1, Tasks 5–9.
- Commit messages: conventional style, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

# PR1 — read side (`feat/tab-groups`)

### Task 1: Protocol — `Tab.groupId`, `TabGroup`, `list_groups`

**Files:**
- Modify: `packages/protocol/src/bridge.ts` (Tab schema, new TabGroup schemas)
- Modify: `packages/protocol/src/policy.ts:78-102` (METHOD_TIERS)
- Test: `packages/protocol/src/bridge.test.ts`, `packages/protocol/src/policy.test.ts:86-119`

**Interfaces:**
- Produces:
  - `Tab.groupId?: number`
  - `TabGroupColor` (zod enum)
  - `TabGroup { groupId, title, color, collapsed, windowId, tabCount, browserId?, browser? }`
  - `ListGroupsResult { groups: TabGroup[] }`
  - `METHOD_TIERS.list_groups = "read"`

- [ ] **Step 1: Write failing tests**

Append to `packages/protocol/src/bridge.test.ts` (and add `ListGroupsResult, TabGroup` to its import from `./bridge.js`):

```ts
describe("tab groups", () => {
  it("Tab accepts an optional groupId", () => {
    expect(Tab.parse({ tabId: 1, title: "t", url: "u", active: true, groupId: 7 }).groupId).toBe(7);
    expect(Tab.parse({ tabId: 1, title: "t", url: "u", active: true }).groupId).toBeUndefined();
  });

  it("TabGroup parses a group and rejects unknown colors", () => {
    const g = {
      groupId: 7,
      title: "reins",
      color: "blue",
      collapsed: false,
      windowId: 1,
      tabCount: 2,
    };
    expect(TabGroup.parse(g)).toEqual(g);
    expect(() => TabGroup.parse({ ...g, color: "magenta" })).toThrow();
    expect(ListGroupsResult.parse({ groups: [g] }).groups).toHaveLength(1);
  });
});
```

In `packages/protocol/src/policy.test.ts`, change the METHOD_TIERS test:
- rename it to `"classifies exactly the 24 bridge methods"`
- add `"list_groups"` to the `read` array

- [ ] **Step 2: Run to verify fail**

Run: `pnpm --filter @reins/protocol test`
Expected: FAIL. `TabGroup` is not exported, and `list_groups` is not classified.

- [ ] **Step 3: Implement**

In `packages/protocol/src/bridge.ts`, add to the `Tab` object (after `active`):

```ts
  /** The tab's group, when it is in one (omitted when ungrouped, or when the
   *  browser has no tab groups). */
  groupId: z.number().optional(),
```

After `export type Tab = …`, add:

```ts
/** Chromium's fixed tab-group palette. */
export const TabGroupColor = z.enum([
  "grey",
  "blue",
  "red",
  "yellow",
  "green",
  "pink",
  "purple",
  "cyan",
  "orange",
]);
export type TabGroupColor = z.infer<typeof TabGroupColor>;

/** A tab group. browserId/browser are tagged by the daemon when aggregating
 *  across several connected browsers. */
export const TabGroup = z.object({
  groupId: z.number(),
  title: z.string(),
  color: TabGroupColor,
  collapsed: z.boolean(),
  windowId: z.number(),
  tabCount: z.number(),
  browserId: z.string().optional(),
  browser: z.string().optional(),
});
export type TabGroup = z.infer<typeof TabGroup>;
```

At the end of the file, add:

```ts
/** Result payload for the `list_groups` method. */
export const ListGroupsResult = z.object({ groups: z.array(TabGroup) });
export type ListGroupsResult = z.infer<typeof ListGroupsResult>;
```

In `packages/protocol/src/policy.ts` METHOD_TIERS, add `list_groups: "read",` after `list_tabs: "read",`.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @reins/protocol test && pnpm --filter @reins/protocol build`
Expected: PASS, and dist rebuilt.

- [ ] **Step 5: Commit**

```bash
git add packages/protocol/src
git commit -m "feat(protocol): tab group schema, Tab.groupId, list_groups tier"
```

---

### Task 2: Extension — `listGroups`, `groupsSupported`, `groupId` in tabs, permission

**Files:**
- Create: `packages/extension/src/lib/tab-groups.ts`
- Create: `packages/extension/src/lib/tab-groups.test.ts`
- Modify: `packages/extension/src/lib/tab-handler.ts:4-14` (listTabs)
- Modify: `packages/extension/src/lib/tab-handler.test.ts`
- Modify: `packages/extension/src/lib/dispatch.ts` (gate + runHandler)
- Modify: `packages/extension/src/lib/dispatch.test.ts`
- Modify: `packages/extension/manifest.config.ts`

**Interfaces:**
- Consumes: `ListGroupsResult`, `TabGroup` from `@reins/protocol` (Task 1)
- Produces:
  - `groupsSupported(): boolean`
  - `requireGroups(): void`, which throws `GroupsUnsupported`
  - `class GroupsUnsupported extends Error { code = "unsupported" }`
  - `listGroups(): Promise<ListGroupsResult>`
  - the `list_groups` dispatch route

- [ ] **Step 1: Write failing tests**

Create `packages/extension/src/lib/tab-groups.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { GroupsUnsupported, groupsSupported, listGroups } from "./tab-groups.js";

afterEach(() => vi.unstubAllGlobals());

/** Minimal chrome with a working tab-group API. */
function stubGroups(overrides: Record<string, unknown> = {}) {
  vi.stubGlobal("chrome", {
    tabs: {
      query: async () => [
        { id: 1, groupId: 7 },
        { id: 2, groupId: 7 },
        { id: 3, groupId: -1 },
      ],
      group: vi.fn(async () => 7),
      ungroup: vi.fn(async () => undefined),
      get: async (id: number) => ({ id, windowId: 1 }),
    },
    tabGroups: {
      query: async () => [{ id: 7, title: "reins", color: "blue", collapsed: false, windowId: 1 }],
      update: vi.fn(async () => ({})),
    },
    ...overrides,
  });
}

describe("groupsSupported", () => {
  it("is true when tabGroups and tabs.group/ungroup exist", () => {
    stubGroups();
    expect(groupsSupported()).toBe(true);
  });

  it("is false without chrome.tabGroups (Arc, Dia, …)", () => {
    stubGroups({ tabGroups: undefined });
    expect(groupsSupported()).toBe(false);
  });

  it("is false when tabs.group is missing", () => {
    stubGroups({ tabs: { query: async () => [] } });
    expect(groupsSupported()).toBe(false);
  });
});

describe("listGroups", () => {
  it("maps groups and counts their tabs", async () => {
    stubGroups();
    expect(await listGroups()).toEqual({
      groups: [
        { groupId: 7, title: "reins", color: "blue", collapsed: false, windowId: 1, tabCount: 2 },
      ],
    });
  });

  it("untitled groups get an empty title", async () => {
    stubGroups({
      tabGroups: {
        query: async () => [{ id: 9, color: "red", collapsed: true, windowId: 2 }],
        update: async () => ({}),
      },
    });
    const { groups } = await listGroups();
    expect(groups[0]).toMatchObject({ groupId: 9, title: "", tabCount: 0 });
  });

  it("throws code=unsupported when the browser has no tab groups", async () => {
    stubGroups({ tabGroups: undefined });
    const err = await listGroups().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GroupsUnsupported);
    expect((err as GroupsUnsupported).code).toBe("unsupported");
    expect((err as Error).message).toBe(
      "this browser doesn't support tab groups (chrome.tabGroups unavailable)",
    );
  });
});
```

Append to the `listTabs` describe in `packages/extension/src/lib/tab-handler.test.ts`:

```ts
  it("carries groupId for grouped tabs, omits it for ungrouped (-1)", async () => {
    vi.stubGlobal("chrome", {
      tabs: {
        query: async () => [
          { id: 1, title: "a", url: "https://a", active: false, groupId: 7 },
          { id: 2, title: "b", url: "https://b", active: false, groupId: -1 },
        ],
      },
    });
    const { tabs } = await listTabs();
    expect(tabs[0]).toEqual({ tabId: 1, title: "a", url: "https://a", active: false, groupId: 7 });
    expect(tabs[1]).not.toHaveProperty("groupId");
  });
```

Append to `packages/extension/src/lib/dispatch.test.ts`, inside `describe("dispatchMethod", …)`:

```ts
  it("list_groups routes to listGroups without a host gate", async () => {
    vi.stubGlobal("chrome", {
      tabs: {
        query: async () => [{ id: 1, groupId: 7 }],
        group: async () => 7,
        ungroup: async () => undefined,
      },
      tabGroups: {
        query: async () => [{ id: 7, title: "x", color: "grey", collapsed: false, windowId: 1 }],
        update: async () => ({}),
      },
    });
    const out = await dispatchWithMeta("list_groups", {});
    expect(out.result).toEqual({
      groups: [{ groupId: 7, title: "x", color: "grey", collapsed: false, windowId: 1, tabCount: 1 }],
    });
    expect(out.meta).toEqual({});
    expect(ensureAllowed).not.toHaveBeenCalled();
  });

  it("list_tabs redaction drops groupId from blocked tabs", async () => {
    vi.stubGlobal("chrome", {
      tabs: {
        query: async () => [{ id: 1, title: "t", url: "https://bank.com/", active: true, groupId: 7 }],
      },
    });
    vi.mocked(policy).mockResolvedValueOnce({
      defaultTier: "full",
      rules: [{ pattern: "bank.com", tier: "deny" }],
    });
    const out = (await dispatchMethod("list_tabs", {})) as { tabs: unknown[] };
    expect(out.tabs[0]).toEqual({ tabId: 1, title: "", url: "", active: true, blocked: true });
  });
```

- [ ] **Step 2: Run to verify fail**

Run: `pnpm --filter @reins/extension test`
Expected: FAIL. `./tab-groups.js` is missing, `groupId` isn't mapped, and `list_groups` hits the default branch ("unknown method").

- [ ] **Step 3: Implement**

Create `packages/extension/src/lib/tab-groups.ts`:

```ts
import type { ListGroupsResult, TabGroup } from "@reins/protocol";

/** The browser has no tab-group API (Arc, Dia, …). `code` survives to the
 *  ResponseFrame, so the agent can tell the user instead of guessing. */
export class GroupsUnsupported extends Error {
  readonly code = "unsupported";
  constructor() {
    super("this browser doesn't support tab groups (chrome.tabGroups unavailable)");
  }
}

/** Every Chromium ships chrome.tabs, but not all ship tab groups: check the
 *  exact calls we make rather than guessing from the browser's name. */
export function groupsSupported(): boolean {
  return (
    typeof chrome.tabGroups?.query === "function" &&
    typeof chrome.tabGroups?.update === "function" &&
    typeof chrome.tabs?.group === "function" &&
    typeof chrome.tabs?.ungroup === "function"
  );
}

export function requireGroups(): void {
  if (!groupsSupported()) throw new GroupsUnsupported();
}

/** Handle the `list_groups` bridge method. */
export async function listGroups(): Promise<ListGroupsResult> {
  requireGroups();
  const [groups, tabs] = await Promise.all([chrome.tabGroups.query({}), chrome.tabs.query({})]);
  const counts = new Map<number, number>();
  for (const t of tabs) {
    if (typeof t.groupId === "number" && t.groupId !== -1) {
      counts.set(t.groupId, (counts.get(t.groupId) ?? 0) + 1);
    }
  }
  return {
    groups: groups.map((g) => ({
      groupId: g.id,
      title: g.title ?? "",
      color: g.color as TabGroup["color"],
      collapsed: g.collapsed,
      windowId: g.windowId,
      tabCount: counts.get(g.id) ?? 0,
    })),
  };
}
```

In `packages/extension/src/lib/tab-handler.ts` `listTabs`, replace the map body:

```ts
    tabs: tabs.map((t) => ({
      tabId: t.id ?? -1,
      title: t.title ?? "",
      url: t.url ?? "",
      active: t.active ?? false,
      ...(typeof t.groupId === "number" && t.groupId !== -1 ? { groupId: t.groupId } : {}),
    })),
```

In `packages/extension/src/lib/dispatch.ts`:
- Add `import { listGroups } from "./tab-groups.js";`
- In `gate`, change the first early return to
  `if (method === "list_tabs" || method === "list_groups") return { params: p, meta: {} };`
- In the doc comment above `gate`, add: "list_groups has no host (group titles are the user's own labels)."
- In `runHandler`, add after the `list_tabs` case:

```ts
    case "list_groups":
      return listGroups();
```

In `packages/extension/manifest.config.ts`:
- Add this comment line after the `tabs:` line:
  `// - tabGroups: list/create/edit tab groups for the agent (no install warning)`
- Change permissions to `["debugger", "tabs", "tabGroups", "storage", "offscreen"]`.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @reins/extension test && pnpm --filter @reins/extension typecheck`
Expected: PASS. If typecheck flags `chrome.tabGroups?.` as a non-optional access, keep it anyway: at runtime the namespace can be undefined. If biome complains, add `// biome-ignore lint/complexity/useOptionalChain: undefined outside Chrome proper` or cast through `(chrome as Partial<typeof chrome>)`.

- [ ] **Step 5: Commit**

```bash
git add packages/extension
git commit -m "feat(extension): list_groups and groupId on tabs, tabGroups permission"
```

---

### Task 3: Daemon aggregation + `reins groups` + tabs marker

**Files:**
- Modify: `packages/cli/src/rpc.ts:12-27` (target helper, `listAllGroups`), `:94-99` (routing)
- Modify: `packages/cli/src/rpc.test.ts`
- Modify: `packages/cli/src/cli-commands.ts` (`groupsText`, tabs marker, help list)
- Modify: `packages/cli/src/cli-commands.test.ts`
- Modify: `packages/cli/src/commands.ts` (`groups` command)
- Modify: `packages/cli/src/commands.test.ts`

**Interfaces:**
- Consumes: `ListGroupsResult`, `TabGroup` (Task 1); the extension's `list_groups` (Task 2)
- Produces:
  - `listAllGroups(bridge: BridgePort, browserId?: string): Promise<TabGroup[]>`
  - `groupsText(groups: TabGroup[]): string`
  - `TOOL_COMMANDS.groups`

- [ ] **Step 1: Write failing tests**

Append to `packages/cli/src/rpc.test.ts` (import `listAllGroups` too):

```ts
describe("listAllGroups", () => {
  const G = { groupId: 7, title: "reins", color: "blue", collapsed: false, windowId: 1, tabCount: 2 };
  const two = [
    { id: "b1", browser: "Chrome", connectedAt: 0 },
    { id: "b2", browser: "Dia", connectedAt: 1 },
  ];

  it("aggregates across browsers with tags, via handleRpc", async () => {
    const bridge = fakeBridge({
      browsers: two,
      request: vi.fn(async () => ({ groups: [G] })),
    });
    const out = (await handleRpc(bridge, { method: "list_groups" })) as { groups: unknown[] };
    expect(out.groups).toEqual([
      { ...G, browserId: "b1", browser: "Chrome" },
      { ...G, browserId: "b2", browser: "Dia" },
    ]);
  });

  it("skips browsers that fail when another answers", async () => {
    const bridge = fakeBridge({
      browsers: two,
      request: vi.fn(async (_m: string, _p: unknown, opts?: { browserId?: string }) => {
        if (opts?.browserId === "b2") throw new Error("unsupported: no tab groups");
        return { groups: [G] };
      }),
    });
    const groups = await listAllGroups(bridge);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ browserId: "b1" });
  });

  it("rethrows the first error when every browser fails", async () => {
    const bridge = fakeBridge({
      request: vi.fn(async () => {
        throw new Error("unsupported: this browser doesn't support tab groups");
      }),
    });
    await expect(listAllGroups(bridge)).rejects.toThrow("unsupported");
  });

  it("returns [] with no browsers connected", async () => {
    expect(await listAllGroups(fakeBridge({ browsers: [] }))).toEqual([]);
  });

  it("errors on an unknown browserId", async () => {
    await expect(listAllGroups(fakeBridge(), "b9")).rejects.toThrow('unknown browserId "b9"');
  });
});
```

Append to `packages/cli/src/cli-commands.test.ts` (import `groupsText`):

```ts
describe("groupsText", () => {
  it("renders one line per group", () => {
    const g = {
      groupId: 7,
      title: "reins",
      color: "blue" as const,
      collapsed: true,
      windowId: 1,
      tabCount: 2,
      browserId: "b1",
    };
    expect(groupsText([g])).toBe('  b1  group 7  "reins"  blue  2 tabs  (collapsed)  window 1');
    expect(groupsText([{ ...g, collapsed: false, tabCount: 1 }])).toBe(
      '  b1  group 7  "reins"  blue  1 tab  window 1',
    );
    expect(groupsText([])).toBe("(no groups)");
  });

  it("tabsText marks grouped tabs", () => {
    const text = tabsText([
      { tabId: 12, title: "T", url: "https://x", active: true, groupId: 7, browserId: "b1" },
    ]);
    expect(text).toBe("  b1  tab 12 *  g7  T — https://x");
  });
});
```

Append to `describe("TOOL_COMMANDS: params", …)` in `packages/cli/src/commands.test.ts`:

```ts
  it("groups: optional browser filter", () => {
    expect(build("groups", [])).toEqual({});
    expect(build("groups", ["--browser", "b2"])).toEqual({ browserId: "b2" });
    expect(cmd("groups").method).toBe("list_groups");
  });
```

- [ ] **Step 2: Run to verify fail**

Run: `pnpm --filter @reins/protocol build && pnpm --filter @karnstack/reins test`
Expected: FAIL. `listAllGroups`, `groupsText`, and `groups` don't exist yet.

- [ ] **Step 3: Implement**

In `packages/cli/src/rpc.ts`:
- Change the import to `import { ListGroupsResult, ListTabsResult, type ResponseMeta, type Tab, type TabGroup } from "@reins/protocol";`
- Replace the top of `listAllTabs` with a shared helper:

```ts
/** The browsers a fan-out call targets: all, or the one named. */
function targetBrowsers(bridge: BridgePort, browserId?: string): BridgePort["browsers"] {
  const targets = browserId ? bridge.browsers.filter((b) => b.id === browserId) : bridge.browsers;
  if (browserId !== undefined && targets.length === 0) {
    const roster = bridge.browsers.map((b) => `${b.id} (${b.browser})`).join(", ");
    throw new Error(`unknown browserId "${browserId}"${roster ? `. Connected: ${roster}` : ""}`);
  }
  return targets;
}

/** List tabs across connected browsers (all, or one), tagging each tab with
 *  its browserId + browser name. */
export async function listAllTabs(bridge: BridgePort, browserId?: string): Promise<Tab[]> {
  const results = await Promise.all(
    targetBrowsers(bridge, browserId).map(async (b) => {
      const raw = await bridge.request("list_tabs", {}, { browserId: b.id });
      const { tabs } = ListTabsResult.parse(raw);
      return tabs.map((t) => ({ ...t, browserId: b.id, browser: b.browser }));
    }),
  );
  return results.flat();
}

/** List tab groups across connected browsers, tagged like listAllTabs. A
 *  browser without tab groups (Arc, Dia) or with an older extension adds
 *  nothing; only when every targeted browser fails does the error surface. */
export async function listAllGroups(bridge: BridgePort, browserId?: string): Promise<TabGroup[]> {
  const settled = await Promise.allSettled(
    targetBrowsers(bridge, browserId).map(async (b) => {
      const raw = await bridge.request("list_groups", {}, { browserId: b.id });
      const { groups } = ListGroupsResult.parse(raw);
      return groups.map((g) => ({ ...g, browserId: b.id, browser: b.browser }));
    }),
  );
  const ok = settled.filter((s) => s.status === "fulfilled");
  const failed = settled.find((s) => s.status === "rejected");
  if (ok.length === 0 && failed) throw failed.reason;
  return ok.flatMap((s) => s.value);
}
```

(If TS doesn't narrow `settled.filter`, use `settled.flatMap((s) => (s.status === "fulfilled" ? s.value : []))`. Keep the `failed` check as it is.)

- In `handleRpc`'s `try`, after the `list_tabs` branch:

```ts
    if (method === "list_groups") {
      const groups = await listAllGroups(bridge, browserId);
      finish({ ok: true, browserId });
      return { groups };
    }
```

In `packages/cli/src/cli-commands.ts`:
- Change the type import to `import type { BrowserInfo, Tab, TabGroup } from "@reins/protocol";`
- In `helpText`, change the tabs list to `...["tabs", "groups", "open", "close", "focus", "nav"].map(tool),`
- Replace `tabsText`'s map line and add `groupsText`:

```ts
/** Tab listing for `reins tabs`. */
export function tabsText(tabs: Tab[]): string {
  if (tabs.length === 0) return "(no tabs)";
  return tabs
    .map(
      (t) =>
        `  ${t.browserId ?? "?"}  tab ${t.tabId}${t.active ? " *" : "  "}${t.groupId !== undefined ? `  g${t.groupId}` : ""}  ${t.title || "(untitled)"} — ${t.url}`,
    )
    .join("\n");
}

/** Group listing for `reins groups`. */
export function groupsText(groups: TabGroup[]): string {
  if (groups.length === 0) return "(no groups)";
  return groups
    .map(
      (g) =>
        `  ${g.browserId ?? "?"}  group ${g.groupId}  "${g.title}"  ${g.color}  ${g.tabCount} tab${g.tabCount === 1 ? "" : "s"}${g.collapsed ? "  (collapsed)" : ""}  window ${g.windowId}`,
    )
    .join("\n");
}
```

In `packages/cli/src/commands.ts`:
- Change the imports to `import type { ConsoleEntry, NetworkEntry, SnapshotRef, Tab, TabGroup } from "@reins/protocol";` and `import { groupsText, tabsText } from "./cli-commands.js";`
- Add after `tabs:`:

```ts
  groups: {
    method: "list_groups",
    usage: "reins groups [--browser <id>]",
    summary: "list tab groups across all connected browsers",
    build: (a) => {
      const browser = flagStr(a, "browser");
      return browser !== undefined ? { browserId: browser } : {};
    },
    format: (r) => groupsText((r as { groups: TabGroup[] }).groups),
  },
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @karnstack/reins test && pnpm --filter @karnstack/reins typecheck`
Expected: PASS, including the existing `tabsText`/help tests (ungrouped tabs render unchanged).

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src
git commit -m "feat(cli): reins groups, group marker in reins tabs"
```

---

### Task 4: PR1 docs, changeset, verification, PR

**Files:**
- Modify: `skills/reins/SKILL.md` (Commands block ~line 90)
- Modify: `packages/web/src/routes/docs/commands.tsx:22-30` (tabs group rows)
- Modify: `docs/CHROME_WEB_STORE.md` (tabGroups justification after the tabs justification ~line 59; the permission list ~line 155; the feature bullet ~line 137)
- Modify: `docs/PRIVACY.md:11-12`
- Create: `.changeset/tab-groups-read.md`

- [ ] **Step 1: Docs**

`skills/reins/SKILL.md` Commands block, after the `tabs / open …` line:

```
groups          tab groups (id, title, color); `tabs` shows g<id> per grouped tab
```

`packages/web/src/routes/docs/commands.tsx`, after the `reins tabs` row:

```ts
      [
        "reins groups [--browser <id>]",
        "List tab groups. reins tabs marks each grouped tab with g<id>.",
      ],
```

`docs/CHROME_WEB_STORE.md`:
- After the tabs justification block, add:

````md
**tabGroups justification**

```text
Lists the user's tab groups (title, color, collapsed state) and, on the agent's behalf, creates groups, adds or removes tabs, and edits a group's title and color — so the user can see which tabs their agent is working in. Group metadata is sent only to the user's own local daemon on 127.0.0.1, never to a remote server.
```
````

- In the "PERMISSIONS, AND WHY" list, add after the `tabs` bullet:
  `• tabGroups — list, create, and edit tab groups, so you can see which tabs your agent is working in.`
- Change the `• Tabs — …` feature bullet (~line 137) to:
  `• Tabs — list, open, close, focus, and group tabs across every connected browser`

`docs/PRIVACY.md` line 11: change "**Page content and tab metadata** (titles, URLs, …" to "**Page content and tab metadata** (titles, URLs, tab group names, …". Also update `_Last updated:` to `2026-09-26`.

- [ ] **Step 2: Changeset**

Create `.changeset/tab-groups-read.md`:

```md
---
"@karnstack/reins": minor
"@reins/extension": minor
---

`reins groups` lists tab groups (title, color, collapsed, tab count) across connected browsers, and `reins tabs` marks each grouped tab with `g<id>`. Browsers without tab groups (Arc, Dia) answer `unsupported` instead of failing silently. The extension asks for the `tabGroups` permission, which shows no install prompt.
```

(Check `.changeset/config.json`. If `@reins/protocol` is not ignored/private, add `"@reins/protocol": minor` too.)

- [ ] **Step 3: Full verification**

Run: `pnpm build && pnpm test && pnpm typecheck && pnpm lint`
Expected: all pass.

- [ ] **Step 4: Manual e2e (real Chrome, own tabs only)**

Follow `local-dev-setup` and `sideload-bundle-order` from memory: `pnpm build` → reload the extension (`reins extension --reload`) → `reins kill`. Then:

```bash
reins groups                      # lists the user's existing groups (read-only), or "(no groups)"
reins tabs | grep ' g' | head -3  # grouped tabs show g<id>
```

Expected: no errors. Nothing is mutated in PR1.

- [ ] **Step 5: Commit, push, PR**

```bash
git add skills packages/web docs .changeset
git commit -m "docs: reins groups, tabGroups permission"
git push -u origin feat/tab-groups
gh pr create --base main --title "feat: reins groups — list tab groups" --body "…summary, test plan…

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

---

# PR2 — write side (`feat/tab-groups-write`, stacked on PR1)

Start: `git checkout -b feat/tab-groups-write` from `feat/tab-groups`.

### Task 5: Protocol — write params + tiers

**Files:**
- Modify: `packages/protocol/src/cdp.ts` (after `SelectTabParams` ~line 92)
- Modify: `packages/protocol/src/policy.ts` (METHOD_TIERS)
- Test: `packages/protocol/src/cdp.test.ts`, `packages/protocol/src/policy.test.ts`

**Interfaces:**
- Consumes: `TabGroupColor` (Task 1, from `./bridge.js`)
- Produces:
  - `GroupTabsParams { browserId?, tabIds: number[] (≥1), groupId?, title?, color?, collapsed? }`
  - `GroupTabsResult { groupId }`
  - `UpdateGroupParams { browserId?, groupId, title?, color?, collapsed? }` (refined: at least one prop)
  - `UngroupTabsParams { browserId?, tabIds?: number[] (≥1), groupId? }` (refined: exactly one)
  - tiers: `group_tabs`, `update_group`, `ungroup_tabs` are all `"read"`

- [ ] **Step 1: Failing tests**

Append to `packages/protocol/src/cdp.test.ts` (import the three schemas from `./cdp.js`):

```ts
describe("tab group params", () => {
  it("GroupTabsParams needs at least one tab and a known color", () => {
    expect(GroupTabsParams.parse({ tabIds: [1, 2], title: "reins", color: "blue" })).toMatchObject({
      tabIds: [1, 2],
    });
    expect(() => GroupTabsParams.parse({ tabIds: [] })).toThrow();
    expect(() => GroupTabsParams.parse({ tabIds: [1], color: "magenta" })).toThrow();
  });

  it("UpdateGroupParams needs something to change", () => {
    expect(UpdateGroupParams.parse({ groupId: 7, collapsed: true }).collapsed).toBe(true);
    expect(() => UpdateGroupParams.parse({ groupId: 7 })).toThrow(/title, color, or collapsed/);
  });

  it("UngroupTabsParams needs exactly one of tabIds or groupId", () => {
    expect(UngroupTabsParams.parse({ tabIds: [1] }).tabIds).toEqual([1]);
    expect(UngroupTabsParams.parse({ groupId: 7 }).groupId).toBe(7);
    expect(() => UngroupTabsParams.parse({})).toThrow(/exactly one/);
    expect(() => UngroupTabsParams.parse({ tabIds: [1], groupId: 7 })).toThrow(/exactly one/);
  });
});
```

In `policy.test.ts`, rename the METHOD_TIERS test to `"classifies exactly the 27 bridge methods"` and add `"group_tabs", "update_group", "ungroup_tabs"` to the `read` array.

- [ ] **Step 2: Run, verify fail**

Run: `pnpm --filter @reins/protocol test`
Expected: FAIL (the schemas aren't exported yet).

- [ ] **Step 3: Implement**

In `packages/protocol/src/cdp.ts`, add `import { TabGroupColor } from "./bridge.js";` at the top. Check first that `bridge.ts` doesn't import `cdp.ts`; it only imports `./policy.js`. After `SelectTabParams`, add:

```ts
/** Group properties the agent may set (all optional). */
const groupProps = {
  title: z.string().optional(),
  color: TabGroupColor.optional(),
  collapsed: z.boolean().optional(),
};

/** `group_tabs`: put tabs in a new group (no groupId) or an existing one. */
export const GroupTabsParams = z.object({
  browserId,
  tabIds: z.array(z.number()).min(1),
  groupId: z.number().optional(),
  ...groupProps,
});
export type GroupTabsParams = z.infer<typeof GroupTabsParams>;

export const GroupTabsResult = z.object({ groupId: z.number() });
export type GroupTabsResult = z.infer<typeof GroupTabsResult>;

/** `update_group`: retitle / recolor / collapse a group. */
export const UpdateGroupParams = z
  .object({ browserId, groupId: z.number(), ...groupProps })
  .refine((v) => v.title !== undefined || v.color !== undefined || v.collapsed !== undefined, {
    message: "update_group needs a title, color, or collapsed",
  });
export type UpdateGroupParams = z.infer<typeof UpdateGroupParams>;

/** `ungroup_tabs`: pull tabs out of their group, or dissolve a whole group.
 *  Never closes tabs. */
export const UngroupTabsParams = z
  .object({
    browserId,
    tabIds: z.array(z.number()).min(1).optional(),
    groupId: z.number().optional(),
  })
  .refine((v) => (v.tabIds === undefined) !== (v.groupId === undefined), {
    message: "ungroup_tabs needs exactly one of tabIds or groupId",
  });
export type UngroupTabsParams = z.infer<typeof UngroupTabsParams>;
```

In `policy.ts` METHOD_TIERS, after `list_groups: "read",`, add:

```ts
  group_tabs: "read",
  update_group: "read",
  ungroup_tabs: "read",
```

Add a comment above these lines: `// Tab-group ops touch the tab strip, never page content: readonly sites may be grouped, denied ones may not.`

- [ ] **Step 4: Run, verify pass; rebuild dist**

Run: `pnpm --filter @reins/protocol test && pnpm --filter @reins/protocol build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/protocol/src
git commit -m "feat(protocol): group_tabs, update_group, ungroup_tabs"
```

---

### Task 6: Extension — group/update/ungroup handlers

**Files:**
- Modify: `packages/extension/src/lib/tab-groups.ts`
- Modify: `packages/extension/src/lib/tab-groups.test.ts`

**Interfaces:**
- Consumes: `GroupTabsParams`, `GroupTabsResult`, `UpdateGroupParams`, `UngroupTabsParams`, `OkResult` (Task 5); `requireGroups` (Task 2)
- Produces:
  - `groupTabs(p: GroupTabsParams): Promise<GroupTabsResult>`
  - `updateGroup(p: UpdateGroupParams): Promise<OkResult>`
  - `ungroupTabs(p: UngroupTabsParams): Promise<OkResult>`
  - `groupTabIds(groupId: number): Promise<number[]>`

- [ ] **Step 1: Failing tests**

Append to `tab-groups.test.ts` (import `groupTabIds, groupTabs, ungroupTabs, updateGroup`). They reuse `stubGroups` from Task 2.

```ts
describe("groupTabs", () => {
  it("creates a new group in the first tab's window, then applies props", async () => {
    stubGroups();
    const out = await groupTabs({ tabIds: [1, 2], title: "reins", color: "blue" });
    expect(out).toEqual({ groupId: 7 });
    expect(chrome.tabs.group).toHaveBeenCalledWith({
      tabIds: [1, 2],
      createProperties: { windowId: 1 },
    });
    expect(chrome.tabGroups.update).toHaveBeenCalledWith(7, { title: "reins", color: "blue" });
  });

  it("adds to an existing group without createProperties, and skips update when no props", async () => {
    stubGroups();
    await groupTabs({ tabIds: [3], groupId: 7 });
    expect(chrome.tabs.group).toHaveBeenCalledWith({ tabIds: [3], groupId: 7 });
    expect(chrome.tabGroups.update).not.toHaveBeenCalled();
  });

  it("refuses with code=unsupported on browsers without groups", async () => {
    stubGroups({ tabGroups: undefined });
    await expect(groupTabs({ tabIds: [1] })).rejects.toBeInstanceOf(GroupsUnsupported);
  });
});

describe("updateGroup", () => {
  it("passes only the given props", async () => {
    stubGroups();
    expect(await updateGroup({ groupId: 7, collapsed: true })).toEqual({ ok: true });
    expect(chrome.tabGroups.update).toHaveBeenCalledWith(7, { collapsed: true });
  });
});

describe("ungroupTabs / groupTabIds", () => {
  it("ungroups the given tabs", async () => {
    stubGroups();
    expect(await ungroupTabs({ tabIds: [1] })).toEqual({ ok: true });
    expect(chrome.tabs.ungroup).toHaveBeenCalledWith([1]);
  });

  it("dissolves a group by ungrouping its tabs (never closes them)", async () => {
    stubGroups();
    const query = vi.fn(async () => [{ id: 1 }, { id: 2 }]);
    (chrome.tabs as { query: unknown }).query = query;
    await ungroupTabs({ groupId: 7 });
    expect(query).toHaveBeenCalledWith({ groupId: 7 });
    expect(chrome.tabs.ungroup).toHaveBeenCalledWith([1, 2]);
  });

  it("an empty group is a no-op", async () => {
    stubGroups();
    (chrome.tabs as { query: unknown }).query = async () => [];
    await ungroupTabs({ groupId: 7 });
    expect(chrome.tabs.ungroup).not.toHaveBeenCalled();
  });

  it("groupTabIds drops tabs without an id", async () => {
    stubGroups();
    (chrome.tabs as { query: unknown }).query = async () => [{ id: 4 }, {}];
    expect(await groupTabIds(7)).toEqual([4]);
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `pnpm --filter @reins/extension test -- tab-groups`
Expected: FAIL (the functions aren't exported).

- [ ] **Step 3: Implement**

Append to `tab-groups.ts`. Extend the type import to `import type { GroupTabsParams, GroupTabsResult, ListGroupsResult, OkResult, TabGroup, UngroupTabsParams, UpdateGroupParams } from "@reins/protocol";`

```ts
type GroupProps = { title?: string; color?: TabGroup["color"]; collapsed?: boolean };

/** Only the props the agent actually set — undefined would reset them. */
function groupProps(p: GroupProps): chrome.tabGroups.UpdateProperties | undefined {
  const out: chrome.tabGroups.UpdateProperties = {};
  if (p.title !== undefined) out.title = p.title;
  if (p.color !== undefined) out.color = p.color as chrome.tabGroups.UpdateProperties["color"];
  if (p.collapsed !== undefined) out.collapsed = p.collapsed;
  return Object.keys(out).length > 0 ? out : undefined;
}

/** The ids of every tab currently in `groupId`. */
export async function groupTabIds(groupId: number): Promise<number[]> {
  const tabs = await chrome.tabs.query({ groupId });
  return tabs.map((t) => t.id).filter((id): id is number => id !== undefined);
}

/** Handle `group_tabs`: a new group, or add to `groupId`; then apply props. */
export async function groupTabs(p: GroupTabsParams): Promise<GroupTabsResult> {
  requireGroups();
  const tabIds = p.tabIds as [number, ...number[]];
  let groupId: number;
  if (p.groupId !== undefined) {
    groupId = await chrome.tabs.group({ tabIds, groupId: p.groupId });
  } else {
    // A new group defaults to the *focused* window, which would drag the
    // tabs across windows — keep it where the first tab already lives.
    const first = await chrome.tabs.get(tabIds[0]);
    groupId = await chrome.tabs.group({ tabIds, createProperties: { windowId: first.windowId } });
  }
  const props = groupProps(p);
  if (props) await chrome.tabGroups.update(groupId, props);
  return { groupId };
}

/** Handle `update_group`. */
export async function updateGroup(p: UpdateGroupParams): Promise<OkResult> {
  requireGroups();
  await chrome.tabGroups.update(p.groupId, groupProps(p) ?? {});
  return { ok: true };
}

/** Handle `ungroup_tabs`: the given tabs, or every tab in `groupId`. The
 *  dispatch gate pins `tabIds` for a group, so gate and handler act on the
 *  same set. Tabs stay open. */
export async function ungroupTabs(p: UngroupTabsParams): Promise<OkResult> {
  requireGroups();
  const tabIds = p.tabIds ?? (p.groupId !== undefined ? await groupTabIds(p.groupId) : []);
  if (tabIds.length > 0) await chrome.tabs.ungroup(tabIds as [number, ...number[]]);
  return { ok: true };
}
```

- [ ] **Step 4: Run, verify pass**

Run: `pnpm --filter @reins/extension test && pnpm --filter @reins/extension typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/extension/src/lib/tab-groups.ts packages/extension/src/lib/tab-groups.test.ts
git commit -m "feat(extension): group, update and ungroup tab handlers"
```

---

### Task 7: Extension — multi-tab policy gate + routing

**Files:**
- Modify: `packages/extension/src/lib/dispatch.ts` (gate, runHandler)
- Modify: `packages/extension/src/lib/dispatch.test.ts`

**Interfaces:**
- Consumes: Task 5 schemas; Task 6 handlers plus `groupTabIds` and `requireGroups`; `ensureAllowed(method, host)` and `PolicyDenied` from `./policy.js`
- Produces: `group_tabs`, `update_group`, and `ungroup_tabs` routed and gated

- [ ] **Step 1: Failing tests**

Append to `dispatch.test.ts` (imports: `PolicyDenied` is already imported):

```ts
describe("tab group gate", () => {
  const URLS: Record<number, string> = {
    1: "https://x.com/",
    2: "https://bank.com/",
    3: "https://docs.com/",
  };
  function stubGroupChrome() {
    vi.stubGlobal("chrome", {
      tabs: {
        get: async (id: number) => ({ id, url: URLS[id], windowId: 1 }),
        query: vi.fn(async () => [{ id: 1 }, { id: 2 }]),
        group: vi.fn(async () => 7),
        ungroup: vi.fn(async () => undefined),
      },
      tabGroups: { query: async () => [], update: vi.fn(async () => ({})) },
    });
  }
  function denyBank() {
    vi.mocked(ensureAllowed).mockImplementation(async (_m, host) => {
      if (host === "bank.com") {
        const e = new PolicyDenied("blocked by policy: bank.com is denied");
        e.meta = { host: "bank.com", tier: "deny" };
        throw e;
      }
      return "read";
    });
  }

  it("group_tabs checks every tab's host at the group_tabs tier", async () => {
    stubGroupChrome();
    const out = await dispatchWithMeta("group_tabs", { tabIds: [1, 3], title: "t" });
    expect(out.result).toEqual({ groupId: 7 });
    expect(vi.mocked(ensureAllowed).mock.calls).toEqual([
      ["group_tabs", "x.com"],
      ["group_tabs", "docs.com"],
    ]);
    expect(out.meta).toEqual({});
  });

  it("one denied tab refuses the whole group_tabs call, tagged with that tab", async () => {
    stubGroupChrome();
    denyBank();
    const err = (await dispatchWithMeta("group_tabs", { tabIds: [1, 2] }).catch(
      (e: unknown) => e,
    )) as PolicyDenied;
    expect(err).toBeInstanceOf(PolicyDenied);
    expect(err.meta).toEqual({ host: "bank.com", tier: "deny", tabId: 2 });
    expect(chrome.tabs.group).not.toHaveBeenCalled();
  });

  it("ungroup --group checks the group's current tabs and ungroups exactly those", async () => {
    stubGroupChrome();
    denyBank();
    await expect(dispatchWithMeta("ungroup_tabs", { groupId: 7 })).rejects.toBeInstanceOf(
      PolicyDenied,
    );
    expect(chrome.tabs.query).toHaveBeenCalledWith({ groupId: 7 });

    vi.mocked(ensureAllowed).mockReset();
    vi.mocked(ensureAllowed).mockResolvedValue("read");
    await dispatchWithMeta("ungroup_tabs", { groupId: 7 });
    expect(chrome.tabs.ungroup).toHaveBeenCalledWith([1, 2]);
  });

  it("update_group has no host gate", async () => {
    stubGroupChrome();
    await dispatchWithMeta("update_group", { groupId: 7, title: "done" });
    expect(ensureAllowed).not.toHaveBeenCalled();
    expect(chrome.tabGroups.update).toHaveBeenCalledWith(7, { title: "done" });
  });

  it("validates params (exactly-one rule) before touching tabs", async () => {
    stubGroupChrome();
    await expect(dispatchWithMeta("ungroup_tabs", {})).rejects.toThrow(/exactly one/);
    await expect(dispatchWithMeta("update_group", { groupId: 7 })).rejects.toThrow(
      /title, color, or collapsed/,
    );
  });

  it("unsupported browser fails before any policy check", async () => {
    vi.stubGlobal("chrome", { tabs: { get: async () => ({}), query: async () => [] } });
    await expect(dispatchWithMeta("ungroup_tabs", { groupId: 7 })).rejects.toThrow(
      "doesn't support tab groups",
    );
    expect(ensureAllowed).not.toHaveBeenCalled();
  });
});
```

Note: `afterEach` already runs `vi.clearAllMocks()`. `mockImplementation` persists across tests unless reset, so add `vi.mocked(ensureAllowed).mockReset(); vi.mocked(ensureAllowed).mockResolvedValue(undefined as never);` in a `beforeEach` inside this describe (import `beforeEach` from vitest).

- [ ] **Step 2: Run, verify fail**

Run: `pnpm --filter @reins/extension test -- dispatch`
Expected: FAIL ("unknown method" or the gate calling `resolveTabId`).

- [ ] **Step 3: Implement**

In `dispatch.ts`:
- Add `GroupTabsParams, UngroupTabsParams, UpdateGroupParams` to the `@reins/protocol` import.
- Replace the tab-groups import with `import { groupTabIds, groupTabs, listGroups, requireGroups, ungroupTabs, updateGroup } from "./tab-groups.js";`

Add this helper above `gate`:

```ts
/** Check every target tab's host; the first denial refuses the whole call,
 *  tagged with that tab for the audit trail. */
async function ensureTabsAllowed(method: GatedMethod, tabIds: number[]): Promise<void> {
  for (const tabId of tabIds) {
    const tab = await chrome.tabs.get(tabId);
    try {
      await ensureAllowed(method, hostOf(tab.url ?? ""));
    } catch (err) {
      if (err instanceof PolicyDenied && err.meta) err.meta = { ...err.meta, tabId };
      throw err;
    }
  }
}
```

In `gate`, replace the first line after `const p = …`:

```ts
  if (method === "list_tabs" || method === "list_groups") return { params: p, meta: {} };
  if (method === "update_group") {
    requireGroups();
    return { params: UpdateGroupParams.parse(p), meta: {} };
  }
  if (method === "group_tabs" || method === "ungroup_tabs") {
    // Before any lookup: on a browser without groups, tabs.query({groupId})
    // may ignore the filter and return every tab.
    requireGroups();
    const parsed = (method === "group_tabs" ? GroupTabsParams : UngroupTabsParams).parse(p);
    const tabIds = parsed.tabIds ?? (await groupTabIds(parsed.groupId as number));
    await ensureTabsAllowed(method, tabIds);
    return { params: { ...parsed, tabIds }, meta: {} };
  }
```

Update the doc comment above `gate`: "Group ops check every target tab (for a whole group, its current tabs) and pin that set in params; update_group only edits the group's label."

In `runHandler`, add after `list_groups`:

```ts
    case "group_tabs":
      return groupTabs(gated as Parameters<typeof groupTabs>[0]);
    case "update_group":
      return updateGroup(gated as Parameters<typeof updateGroup>[0]);
    case "ungroup_tabs":
      return ungroupTabs(gated as Parameters<typeof ungroupTabs>[0]);
```

- [ ] **Step 4: Run, verify pass**

Run: `pnpm --filter @reins/extension test && pnpm --filter @reins/extension typecheck`
Expected: PASS, all existing dispatch tests included.

- [ ] **Step 5: Commit**

```bash
git add packages/extension/src/lib/dispatch.ts packages/extension/src/lib/dispatch.test.ts
git commit -m "feat(extension): policy gate for tab group ops"
```

---

### Task 8: CLI — `reins group`, `reins ungroup`

**Files:**
- Modify: `packages/cli/src/commands.ts` (ToolCommand `methodFor`, two commands)
- Modify: `packages/cli/src/cli.ts:55` (use `methodFor`)
- Modify: `packages/cli/src/cli-commands.ts` (help list)
- Modify: `packages/cli/src/commands.test.ts`

**Interfaces:**
- Consumes: the protocol methods `group_tabs`, `update_group`, `ungroup_tabs` (Task 5)
- Produces:
  - `ToolCommand.methodFor?(params: Record<string, unknown>): string`
  - `TOOL_COMMANDS.group`, `TOOL_COMMANDS.ungroup`

- [ ] **Step 1: Failing tests**

Append to `describe("TOOL_COMMANDS: params", …)` in `commands.test.ts`:

```ts
  it("group: repeatable --tab creates a group; props map through", () => {
    const p = build("group", ["--tab", "12", "--tab", "13", "--title", "reins", "--color", "blue"]);
    expect(p).toEqual({ tabIds: [12, 13], title: "reins", color: "blue" });
    expect(cmd("group").methodFor?.(p)).toBe("group_tabs");
  });

  it("group: --tab with --group adds to that group", () => {
    const p = build("group", ["--tab", "14", "--group", "7", "--browser", "b1"]);
    expect(p).toEqual({ tabIds: [14], groupId: 7, browserId: "b1" });
    expect(cmd("group").methodFor?.(p)).toBe("group_tabs");
  });

  it("group: --group without --tab edits the group", () => {
    const p = build("group", ["--group", "7", "--collapse"]);
    expect(p).toEqual({ groupId: 7, collapsed: true });
    expect(cmd("group").methodFor?.(p)).toBe("update_group");
    expect(build("group", ["--group", "7", "--expand"])).toEqual({ groupId: 7, collapsed: false });
  });

  it("group: usage errors", () => {
    expect(() => build("group", [])).toThrow(UsageError);
    expect(() => build("group", ["--group", "7"])).toThrow(/--title, --color, --collapse/);
    expect(() => build("group", ["--tab", "1", "--collapse", "--expand"])).toThrow(UsageError);
    expect(() => build("group", ["--tab", "1", "--color", "magenta"])).toThrow(UsageError);
    expect(() => build("group", ["--tab", "x"])).toThrow(UsageError);
  });

  it("group: formats the group id or ok", () => {
    expect(format("group", { groupId: 7 })).toBe("group 7");
    expect(format("group", { ok: true })).toBe("ok");
  });

  it("ungroup: exactly one of --tab or --group", () => {
    expect(build("ungroup", ["--tab", "1", "--tab", "2"])).toEqual({ tabIds: [1, 2] });
    expect(build("ungroup", ["--group", "7"])).toEqual({ groupId: 7 });
    expect(() => build("ungroup", [])).toThrow(UsageError);
    expect(() => build("ungroup", ["--tab", "1", "--group", "7"])).toThrow(UsageError);
    expect(cmd("ungroup").method).toBe("ungroup_tabs");
  });
```

- [ ] **Step 2: Run, verify fail**

Run: `pnpm --filter @reins/protocol build && pnpm --filter @karnstack/reins test -- commands`
Expected: FAIL (no such command: group).

- [ ] **Step 3: Implement**

In `commands.ts`, add to the `ToolCommand` interface after `method: string;`:

```ts
  /** Pick the bridge method from the built params, when one command covers
   *  several (default: `method`). */
  methodFor?(params: Record<string, unknown>): string;
```

Add helpers after `oneOf`:

```ts
const GROUP_COLORS = ["grey", "blue", "red", "yellow", "green", "pink", "purple", "cyan", "orange"];

/** Repeatable --tab → tab ids (undefined when absent). */
function tabList(a: ParsedArgs): number[] | undefined {
  const v = a.flags.tab;
  if (v === undefined) return undefined;
  const list = Array.isArray(v) ? v : [v];
  return list.map((s) => {
    const n = Number(s);
    if (typeof s !== "string" || !Number.isInteger(n)) {
      throw new UsageError(`--tab must be an integer, got "${String(s)}"`);
    }
    return n;
  });
}

/** --title / --color / --collapse|--expand → group props. */
function groupProps(a: ParsedArgs): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const title = flagStr(a, "title");
  if (title !== undefined) out.title = title;
  const color = oneOf(a, "color", GROUP_COLORS);
  if (color !== undefined) out.color = color;
  if (a.flags.collapse === true && a.flags.expand === true) {
    throw new UsageError("--collapse and --expand are mutually exclusive");
  }
  if (a.flags.collapse === true) out.collapsed = true;
  if (a.flags.expand === true) out.collapsed = false;
  return out;
}

function browserOnly(a: ParsedArgs): Record<string, unknown> {
  const browser = flagStr(a, "browser");
  return browser !== undefined ? { browserId: browser } : {};
}
```

(Refactor `tabs.build` and `groups.build` to `browserOnly(a)` while here.)

Add the commands after `groups:`:

```ts
  group: {
    method: "group_tabs",
    methodFor: (p) => (p.tabIds === undefined ? "update_group" : "group_tabs"),
    usage:
      "reins group --tab <id> [--tab <id> …] [--group <gid>] [--title <t>] [--color <c>] [--collapse|--expand]\n       reins group --group <gid> [--title <t>] [--color <c>] [--collapse|--expand]",
    summary: "group tabs (new group, or --group to add/edit one)",
    booleans: ["collapse", "expand"],
    multi: ["tab"],
    build: (a) => {
      const tabIds = tabList(a);
      const groupId = flagInt(a, "group");
      const props = groupProps(a);
      if (tabIds === undefined && groupId === undefined) {
        throw new UsageError("--tab (to group tabs) or --group (to edit a group) is required");
      }
      if (tabIds === undefined && Object.keys(props).length === 0) {
        throw new UsageError("editing a group needs --title, --color, --collapse or --expand");
      }
      return {
        ...browserOnly(a),
        ...(tabIds !== undefined ? { tabIds } : {}),
        ...(groupId !== undefined ? { groupId } : {}),
        ...props,
      };
    },
    format: (r) => {
      const g = r as { groupId?: number };
      return g.groupId !== undefined ? `group ${g.groupId}` : "ok";
    },
  },
  ungroup: {
    method: "ungroup_tabs",
    usage: "reins ungroup --tab <id> [--tab <id> …] | --group <gid>",
    summary: "take tabs out of their group, or dissolve a group (tabs stay open)",
    multi: ["tab"],
    build: (a) => {
      const tabIds = tabList(a);
      const groupId = flagInt(a, "group");
      if ((tabIds === undefined) === (groupId === undefined)) {
        throw new UsageError("exactly one of --tab or --group is required");
      }
      return {
        ...browserOnly(a),
        ...(tabIds !== undefined ? { tabIds } : { groupId }),
      };
    },
    format: ok,
  },
```

In `cli.ts:55`, change the call to `const result = await rpc(ensured.port, cmd.methodFor?.(params) ?? cmd.method, params);`

In `cli-commands.ts` `helpText`, change the tabs list to `["tabs", "groups", "group", "ungroup", "open", "close", "focus", "nav"]`.

Check `format`'s helper in the test: it calls `c.format?.(result, parseArgs(argv))`, which works as is.

- [ ] **Step 4: Run, verify pass**

Run: `pnpm --filter @karnstack/reins test && pnpm --filter @karnstack/reins typecheck`
Expected: PASS. The "every command has a usage line" test must see `reins group` and `reins ungroup` in their usage.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src
git commit -m "feat(cli): reins group and reins ungroup"
```

---

### Task 9: PR2 docs, changeset, e2e, PR

**Files:**
- Modify: `skills/reins/SKILL.md`
- Modify: `packages/web/src/routes/docs/commands.tsx`
- Create: `.changeset/tab-groups-write.md`

- [ ] **Step 1: Docs**

`skills/reins/SKILL.md` Commands block, replace the `groups` line from Task 4 with:

```
groups          tab groups (id, title, color); `tabs` shows g<id> per grouped tab
group           --tab <id> [--tab …] [--group <gid>] [--title T] [--color blue] [--collapse|--expand]
                no --tab + --group <gid>: edit that group
ungroup         --tab <id> [--tab …] | --group <gid>   (tabs stay open)
```

Add a short paragraph after the Commands block (or in the tips section):

```md
**Tab groups.** You can put the tabs you open for a task into a group
(`reins group --tab 12 --tab 13 --title reins --color blue`) so the user sees
which tabs are yours. Don't regroup the user's own tabs unless they ask.
Arc and Dia have no tab groups; those commands answer `unsupported` there.
```

`packages/web/src/routes/docs/commands.tsx`, after the `reins groups` row:

```ts
      [
        "reins group --tab <id> [--tab <id> …] [--group <gid>] [--title <t>] [--color <c>] [--collapse|--expand]",
        "Put tabs in a new group, or in an existing one with --group. With --group and no --tab, edit the group.",
      ],
      [
        "reins ungroup --tab <id> [--tab <id> …] | --group <gid>",
        "Take tabs out of their group, or dissolve a whole group. Tabs stay open.",
      ],
```

- [ ] **Step 2: Changeset**

Create `.changeset/tab-groups-write.md` (add `@reins/protocol` if Task 4 found it versioned):

```md
---
"@karnstack/reins": minor
"@reins/extension": minor
---

`reins group` puts tabs in a new or existing tab group and edits a group's title, color, and collapsed state. `reins ungroup` takes tabs out of their group or dissolves a whole group, and never closes tabs. reins groups nothing on its own; the agent decides. Group operations count as reading: read-only sites can be grouped, denied sites cannot.
```

- [ ] **Step 3: Full verification**

Run: `pnpm build && pnpm test && pnpm typecheck && pnpm lint`
Expected: all pass.

- [ ] **Step 4: Manual e2e (real Chrome, only tabs reins opens)**

Rebuild and reload per memory: `pnpm build` → `reins extension --reload` → `reins kill`. Then:

```bash
A=$(reins open https://example.com --background --json | jq .tabId)
B=$(reins open https://example.org --background --json | jq .tabId)
G=$(reins group --tab $A --tab $B --title reins-e2e --color orange --json | jq .groupId)
reins groups | grep reins-e2e              # 2 tabs, orange
reins tabs | grep "g$G"                    # both tabs marked
reins group --group $G --collapse && reins groups | grep collapsed
reins ungroup --tab $A && reins groups | grep reins-e2e   # 1 tab
reins ungroup --group $G && reins groups | grep -c reins-e2e   # 0 — group gone
reins close --tab $A && reins close --tab $B              # cleanup
```

Expected: every step matches the comment, and the user's own tabs and groups are unchanged. If a Dia or Arc browser is connected, run `reins group --browser <id> --tab <id> …` and confirm it answers `unsupported: …`.

- [ ] **Step 5: Commit, push, stacked PR**

```bash
git add skills packages/web .changeset
git commit -m "docs: reins group / ungroup"
git push -u origin feat/tab-groups-write
gh pr create --base feat/tab-groups --title "feat: reins group / ungroup" --body "Stacked on #<PR1>. …summary, test plan…

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```
