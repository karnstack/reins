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
async function gate(method: GatedMethod, params: unknown): Promise<Record<string, unknown>> {
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
    if (!NAV_HISTORY.has(to)) {
      let dest = hostOf(to);
      if (dest === undefined) {
        // Protocol-relative ("//bank.com/x") and path-relative targets
        // resolve against the current page — check what they resolve to,
        // or they would dodge the destination gate.
        try {
          dest = hostOf(new URL(to, tab.url).href);
        } catch {
          // unresolvable target — the handler will reject it
        }
      }
      if (dest !== undefined) await ensureAllowed("navigate", dest);
    }
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
    case "select_tab":
      return selectTab(gated as Parameters<typeof selectTab>[0]);
    case "navigate":
      return cdpNavigate(gated as Parameters<typeof cdpNavigate>[0]);
    case "read_snapshot":
      return cdpSnapshot(gated as Parameters<typeof cdpSnapshot>[0]);
    case "click":
      return cdpClick(gated as Parameters<typeof cdpClick>[0]);
    case "type":
      return cdpType(gated as Parameters<typeof cdpType>[0]);
    case "screenshot":
      return cdpScreenshot(gated as Parameters<typeof cdpScreenshot>[0]);
    case "eval_js":
      return cdpEval(gated as Parameters<typeof cdpEval>[0]);
    case "wait_for":
      return cdpWaitFor(gated as Parameters<typeof cdpWaitFor>[0]);
    case "read_console":
      return readConsole(gated as Parameters<typeof readConsole>[0]);
    case "read_network":
      return readNetwork(gated as Parameters<typeof readNetwork>[0]);
    case "press_key":
      return pressKey(gated as Parameters<typeof pressKey>[0]);
    case "hover":
      return hover(gated as Parameters<typeof hover>[0]);
    case "scroll":
      return scroll(gated as Parameters<typeof scroll>[0]);
    case "fill":
      return fill(gated as Parameters<typeof fill>[0]);
    case "select_option":
      return selectOption(gated as Parameters<typeof selectOption>[0]);
    case "upload":
      return upload(gated as Parameters<typeof upload>[0]);
    case "read_text":
      return readText(gated as Parameters<typeof readText>[0]);
    case "resize":
      return resizeWindow(gated as Parameters<typeof resizeWindow>[0]);
    case "handle_dialog":
      return handleDialog(gated as Parameters<typeof handleDialog>[0]);
    case "cdp":
      return cdpRaw(gated as Parameters<typeof cdpRaw>[0]);
    default:
      throw new Error(`unknown method: ${method}`);
  }
}
