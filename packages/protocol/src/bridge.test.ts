import { describe, expect, it } from "vitest";
import { ListTabsResult, RequestFrame, ResponseFrame, Tab, WelcomeFrame } from "./bridge.js";

describe("bridge frames", () => {
  it("accepts a valid request frame", () => {
    const f = RequestFrame.parse({ type: "request", id: "abc", method: "list_tabs", params: {} });
    expect(f.method).toBe("list_tabs");
  });

  it("rejects a request frame with the wrong type literal", () => {
    expect(() => RequestFrame.parse({ type: "response", id: "abc", method: "x", params: {} })).toThrow();
  });

  it("accepts an ok response with a result", () => {
    const f = ResponseFrame.parse({ type: "response", id: "abc", ok: true, result: { tabs: [] } });
    expect(f.ok).toBe(true);
  });

  it("accepts a failed response with an error", () => {
    const f = ResponseFrame.parse({ type: "response", id: "abc", ok: false, error: { code: "E", message: "boom" } });
    expect(f.error?.code).toBe("E");
  });

  it("validates a Tab and a ListTabsResult", () => {
    const tab = Tab.parse({ tabId: 7, title: "t", url: "https://x", active: true });
    const res = ListTabsResult.parse({ tabs: [tab] });
    expect(res.tabs[0]?.tabId).toBe(7);
  });

  it("validates a welcome frame", () => {
    expect(WelcomeFrame.parse({ type: "welcome", server: "reins" }).server).toBe("reins");
  });
});
