import type { Tab } from "@reins/protocol";

/** Handle the `list_tabs` bridge method using chrome.tabs. */
export async function listTabs(): Promise<{ tabs: Tab[] }> {
  const tabs = await chrome.tabs.query({});
  return {
    tabs: tabs.map((t) => ({
      tabId: t.id ?? -1,
      title: t.title ?? "",
      url: t.url ?? "",
      active: t.active ?? false,
    })),
  };
}
