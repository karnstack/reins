import type { ListGroupsResult } from "@reins/protocol";

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
