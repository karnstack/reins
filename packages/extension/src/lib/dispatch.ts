import { cdpClick, cdpNavigate, cdpSnapshot, cdpType } from "./cdp.js";
import { closeTab, listTabs, openTab, selectTab } from "./tab-handler.js";

/**
 * Route an incoming bridge method name to the appropriate browser handler.
 * Add new cases here as more MCP tools are implemented.
 */
export async function dispatchMethod(method: string, params: unknown): Promise<unknown> {
  switch (method) {
    case "list_tabs":
      return listTabs();
    case "open_tab":
      return openTab(params as Parameters<typeof openTab>[0]);
    case "close_tab":
      return closeTab(params as Parameters<typeof closeTab>[0]);
    case "select_tab":
      return selectTab(params as Parameters<typeof selectTab>[0]);
    case "navigate":
      return cdpNavigate(params as Parameters<typeof cdpNavigate>[0]);
    case "read_snapshot":
      return cdpSnapshot(params as Parameters<typeof cdpSnapshot>[0]);
    case "click":
      return cdpClick(params as Parameters<typeof cdpClick>[0]);
    case "type":
      return cdpType(params as Parameters<typeof cdpType>[0]);
    default:
      throw new Error(`unknown method: ${method}`);
  }
}
