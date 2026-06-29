import { listTabs } from "./tab-handler.js";

/**
 * Route an incoming bridge method name to the appropriate browser handler.
 * Add new cases here as more MCP tools are implemented.
 */
export async function dispatchMethod(method: string, _params: unknown): Promise<unknown> {
  switch (method) {
    case "list_tabs":
      return listTabs();
    default:
      throw new Error(`unknown method: ${method}`);
  }
}
