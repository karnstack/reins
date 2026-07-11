import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * monitor.ts registers chrome listeners at module load, so the chrome stub
 * must exist BEFORE the dynamic import, and the module registry is reset per
 * test to re-run that registration against a fresh stub.
 */

type DebuggerEventListener = (source: { tabId?: number }, method: string, params?: unknown) => void;
type TabsUpdatedListener = (tabId: number, changeInfo: { url?: string }) => void;

let onEvent: DebuggerEventListener;
let onUpdated: TabsUpdatedListener;
let tabUrl: string;

function installChrome(): void {
  vi.stubGlobal("chrome", {
    debugger: {
      onEvent: {
        addListener: (l: DebuggerEventListener) => {
          onEvent = l;
        },
      },
      onDetach: { addListener: () => {} },
      attach: async () => {},
      detach: async () => {},
      sendCommand: async () => {},
    },
    tabs: {
      onUpdated: {
        addListener: (l: TabsUpdatedListener) => {
          onUpdated = l;
        },
      },
      get: async (id: number) => ({ id, url: tabUrl }),
      query: async () => [{ id: 1, url: tabUrl, active: true }],
    },
  });
}

async function loadMonitor() {
  vi.resetModules();
  installChrome();
  return import("./monitor.js");
}

beforeEach(() => {
  tabUrl = "https://allowed.com/";
});

describe("monitor buffers across navigation", () => {
  it("clears console and network buffers when the tab changes host", async () => {
    const { readConsole, readNetwork } = await loadMonitor();

    // First read attaches and starts capturing on allowed.com.
    expect((await readConsole({ tabId: 5 })).entries).toEqual([]);
    onEvent({ tabId: 5 }, "Runtime.consoleAPICalled", {
      type: "log",
      args: [{ value: "secret" }],
      timestamp: 1000,
    });
    onEvent({ tabId: 5 }, "Network.requestWillBeSent", {
      requestId: "r1",
      request: { method: "GET", url: "https://allowed.com/api" },
      timestamp: 1,
      wallTime: 2,
    });
    expect((await readConsole({ tabId: 5 })).entries).toHaveLength(1);
    expect((await readNetwork({ tabId: 5 })).entries).toHaveLength(1);

    // Tab navigates to a different host — captured telemetry must not
    // survive into reads made under the new host's policy tier.
    onUpdated(5, { url: "https://other.com/page" });
    expect((await readConsole({ tabId: 5 })).entries).toEqual([]);
    expect((await readNetwork({ tabId: 5 })).entries).toEqual([]);
  });

  it("keeps buffers across same-host navigation", async () => {
    const { readConsole } = await loadMonitor();
    await readConsole({ tabId: 5 });
    onEvent({ tabId: 5 }, "Runtime.consoleAPICalled", {
      type: "log",
      args: [{ value: "kept" }],
      timestamp: 1000,
    });
    onUpdated(5, { url: "https://allowed.com/other-page" });
    expect((await readConsole({ tabId: 5 })).entries).toHaveLength(1);
  });

  it("ignores updates without a url change", async () => {
    const { readConsole } = await loadMonitor();
    await readConsole({ tabId: 5 });
    onEvent({ tabId: 5 }, "Runtime.consoleAPICalled", {
      type: "log",
      args: [{ value: "kept" }],
      timestamp: 1000,
    });
    onUpdated(5, {});
    expect((await readConsole({ tabId: 5 })).entries).toHaveLength(1);
  });
});
