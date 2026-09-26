import type {
  GroupTabsParams,
  GroupTabsResult,
  ListGroupsResult,
  OkResult,
  TabGroupColor,
  UngroupTabsParams,
  UpdateGroupParams,
} from "@reins/protocol";

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
      color: g.color,
      collapsed: g.collapsed,
      windowId: g.windowId,
      tabCount: counts.get(g.id) ?? 0,
    })),
  };
}

type GroupProps = { title?: string; color?: TabGroupColor; collapsed?: boolean };

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
