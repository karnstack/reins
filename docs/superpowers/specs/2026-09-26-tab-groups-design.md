# Tab groups — design

Date: 2026-09-26
Status: approved in chat, pending spec review

## Problem

Users want to see which tabs their agent is working in. Chromium tab groups
are the natural marker, and they're also a general "organize my tabs" tool.
reins works with any Chromium browser (Chrome, Edge, Brave, Vivaldi, Opera,
Arc, Dia, …), and not all of them support tab groups.

## Principle

reins ships **primitives only**: list, create/add, edit, ungroup. It never
groups anything on its own. The agent decides when and how to group (for
example "put the tabs I opened for this task in a group titled `reins`"),
the same way it decides what to click.

## Scope

In:

- `Tab.groupId` in `reins tabs`
- `reins groups`: list groups
- `reins group`: create a group, add tabs to a group, edit a group's title,
  color, or collapsed state
- `reins ungroup`: remove tabs from their group, or dissolve a whole group
- A clear `unsupported` error on browsers without tab groups
- Skill and web docs, store/privacy permission text, changeset

Out (YAGNI):

- Auto-grouping, a popup toggle, or any other extension-side behavior
- Deleting a group together with its tabs. `ungroup` never closes tabs; the
  agent uses `reins close` when it means to close them.
- Moving groups between windows, or reordering groups
- Advertising a per-browser capability in the hello/roster

## CLI (flat verbs, matching tabs/open/close/focus)

```
reins groups [--browser <id>]
reins group --tab <id> [--tab <id> …] [--group <gid>] [--title <t>] [--color <c>] [--collapse|--expand]
reins group --group <gid> [--title <t>] [--color <c>] [--collapse|--expand]
reins ungroup --tab <id> [--tab <id> …]
reins ungroup --group <gid>
```

- `group` with `--tab` maps to `group_tabs`. Without `--group` it creates a
  new group; with `--group` it adds the tabs to that group. Title, color, and
  collapsed are applied afterwards. Prints `group <gid>`.
- `group` with `--group` and no `--tab` maps to `update_group`. It needs at
  least one of `--title`, `--color`, `--collapse`, or `--expand`.
- `group` with neither `--tab` nor `--group` is a UsageError.
- `--collapse` and `--expand` together is a UsageError.
- `ungroup` needs exactly one of `--tab` (repeatable) or `--group`.
- `--color` must be one of: grey, blue, red, yellow, green, pink, purple,
  cyan, orange. Anything else is a UsageError.
- `tabs` text output gets a group marker per grouped tab (`g<gid>`).
- `groups` text output: one line per group,
  `<browserId>  group <gid>  "<title>"  <color>  <n> tabs[  (collapsed)]  window <wid>`.
  Prints `(no groups)` when there are none.
- Help lists `groups`, `group`, and `ungroup` under "Tabs & pages".

## Protocol (`@reins/protocol`)

- `Tab` gets `groupId: z.number().optional()`. It's left out when the tab is
  ungrouped (Chrome reports `-1`) or when the browser has no groups.
- `TabGroupColor = z.enum([grey, blue, red, yellow, green, pink, purple, cyan, orange])`
- `TabGroup = { groupId, title, color, collapsed, windowId, tabCount, browserId?, browser? }`
- `ListGroupsResult = { groups: TabGroup[] }`
- `GroupTabsParams = { tabIds: number[] (min 1), groupId?, title?, color?, collapsed? }`, result `{ groupId }`
- `UpdateGroupParams = { groupId, title?, color?, collapsed? }`, result `OkResult`
- `UngroupTabsParams = { tabIds?: number[] (min 1) , groupId? }`, with exactly one of the two set. Result is `OkResult`.
- `METHOD_TIERS`: `list_groups`, `group_tabs`, `update_group`, and
  `ungroup_tabs` are all `"read"`. Grouping never touches page content, so
  readonly sites can be grouped; denied sites are refused.

## Extension

New module `packages/extension/src/lib/tab-groups.ts`:

- `groupsSupported()`: true only when `chrome.tabGroups?.query`,
  `chrome.tabGroups?.update`, `chrome.tabs.group`, and `chrome.tabs.ungroup`
  are all functions.
- Every handler first calls `requireGroups()`. When groups are unsupported it
  throws an `Error` whose `code` is `"unsupported"`, with the message: `this
  browser doesn't support tab groups (chrome.tabGroups unavailable)`. The
  bridge client already forwards `err.code` in the response frame.
- `listGroups()`: `chrome.tabGroups.query({})`, with `tabCount` taken from
  `chrome.tabs.query({})` counted per `groupId`.
- `groupTabs(p)`: `chrome.tabs.group({ tabIds, groupId? })`, then
  `chrome.tabGroups.update` if any props were given. Returns `{ groupId }`.
- `updateGroup(p)`: `chrome.tabGroups.update(groupId, props)`.
- `ungroupTabs(p)`: when given a `groupId`, it resolves the group's tabs with
  `chrome.tabs.query({ groupId })`, then calls `chrome.tabs.ungroup(tabIds)`.
- Chrome's own errors (bad group id, a tab in a non-normal window) pass
  through unchanged.

`tab-handler.ts` `listTabs()` sets `groupId` when `t.groupId` is a number
other than `-1`.

`dispatch.ts` gate:

- `list_groups` and `update_group` get no host check. Group titles are the
  user's own labels, not site content. `list_tabs` redaction already rebuilds
  blocked tabs from scratch as `{tabId, title:"", url:"", active, blocked}`,
  so `groupId` is dropped for them. That's consistent: blocked tabs show
  nothing beyond their id.
- `group_tabs` and `ungroup_tabs` get a multi-tab check. The gate resolves
  every target tab (for `ungroup --group`, the group's current tabs), then
  runs `ensureAllowed(method, host)` on each one. The first denial refuses
  the whole call, and `PolicyDenied.meta` gets that tab's id. The response's
  `meta` has no single host or tabId, so it stays `{}`. The audit record
  still carries the params (the tabIds).
- The handler receives the resolved `tabIds`, so the gate and the handler
  act on the same set.

Manifest: add `"tabGroups"` to `permissions`, and update the comment block.
The permission shows no install warning, so existing users don't have to
re-approve anything on update. Browsers that don't know the permission
ignore it with a load-time warning; the extension still loads.

## Daemon (`packages/cli/src/rpc.ts`)

`list_groups` aggregates across browsers the same way `list_tabs` does: it
fans out to every targeted browser and tags each group with `browserId` and
`browser`. A browser that fails (`unsupported`, or an older extension that
answers `unknown method`) contributes no groups. If every targeted browser
fails, the first error is rethrown so the agent sees why. The call is still
audited like any other.

All other group methods route to one browser through the existing
`bridge.requestFull` path.

## Errors

| Case | Result |
|---|---|
| Browser lacks tab groups | `unsupported`: "this browser doesn't support tab groups …" |
| Older extension without these methods | `unknown method: <m>`, as today |
| Denied host on any target tab | `policy_denied`, audited with `denied: true` |
| Bad group id or tab id | Chrome's error message, unchanged |
| Bad flags | UsageError with usage text |

## Docs

- `skills/reins/SKILL.md`: document the three commands, plus one line of
  guidance: "you can group the tabs you open for a task (e.g. title `reins`)
  so the user sees which tabs are yours; don't regroup the user's tabs
  unless asked."
- Web docs (`packages/web/src/routes/docs/commands.tsx`): add the three
  commands.
- `docs/CHROME_WEB_STORE.md`: add a `tabGroups` justification and update the
  permission list. `docs/PRIVACY.md`: add a mention if it lists permissions.
- One changeset per PR (minor bump for cli, extension, and protocol).

## Testing

- protocol: schema tests for the new params (exactly-one rule in
  `UngroupTabsParams`, color enum) and for `Tab.groupId`
- extension `tab-groups.test.ts` with stubbed `chrome`: unsupported
  detection, create, add to existing, props applied, ungroup by tabs,
  ungroup by group, tabCount
- extension `tab-handler.test.ts`: groupId is mapped, and `-1` is left out
- extension `dispatch.test.ts`: multi-tab gate refuses when any tab is
  denied, lets readonly tabs through, and `ungroup --group` checks the
  group's tabs
- cli `commands` tests: build and format for groups/group/ungroup, plus
  every usage error
- cli `rpc` test: `list_groups` aggregation, including partial failure and
  total failure
- Manual e2e in real Chrome: only on tabs reins opens itself. The user's
  existing tabs and groups are never touched. Clean up afterwards by closing
  those tabs.

## Delivery (stacked PRs)

1. `feat/tab-groups`, the read side: protocol `Tab.groupId`, `TabGroup`,
   and `list_groups`; the `tabGroups` permission; `listGroups` +
   `groupsSupported`; `reins groups`; the `tabs` marker; daemon
   aggregation; store/privacy text; skill and web docs for `groups`;
   changeset.
2. `feat/tab-groups-write`, stacked on 1: `group_tabs`, `update_group`,
   `ungroup_tabs`, the multi-tab gate, `reins group`/`ungroup`, skill and
   web docs for them plus the grouping guidance line, changeset.
