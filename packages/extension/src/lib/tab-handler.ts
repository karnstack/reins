import type {
  CloseTabParams,
  OkResult,
  OpenTabParams,
  OpenTabResult,
  SelectTabParams,
  Tab,
} from "@reins/protocol";

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

/** Handle the `open_tab` bridge method using chrome.tabs. */
export async function openTab({ url, activate }: OpenTabParams): Promise<OpenTabResult> {
  const created = await chrome.tabs.create({ url, active: activate });
  return { tabId: created.id ?? -1 };
}

/** Handle the `close_tab` bridge method using chrome.tabs. */
export async function closeTab({ tabId }: CloseTabParams): Promise<OkResult> {
  await chrome.tabs.remove(tabId);
  return { ok: true };
}

/** Handle the `select_tab` bridge method using chrome.tabs. */
export async function selectTab({ tabId }: SelectTabParams): Promise<OkResult> {
  await chrome.tabs.update(tabId, { active: true });
  return { ok: true };
}
