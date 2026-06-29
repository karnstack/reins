import {
  cdpClick,
  cdpEval,
  cdpNavigate,
  cdpScreenshot,
  cdpSnapshot,
  cdpType,
  cdpWaitFor,
} from "./cdp.js";
import { readConsole, readNetwork } from "./monitor.js";
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
    case "screenshot":
      return cdpScreenshot(params as Parameters<typeof cdpScreenshot>[0]);
    case "eval_js":
      return cdpEval(params as Parameters<typeof cdpEval>[0]);
    case "wait_for":
      return cdpWaitFor(params as Parameters<typeof cdpWaitFor>[0]);
    case "read_console":
      return readConsole(params as Parameters<typeof readConsole>[0]);
    case "read_network":
      return readNetwork(params as Parameters<typeof readNetwork>[0]);
    default:
      throw new Error(`unknown method: ${method}`);
  }
}
