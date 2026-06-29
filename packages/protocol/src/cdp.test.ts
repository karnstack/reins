import { describe, expect, it } from "vitest";
import {
  ClickParams,
  CloseTabParams,
  NavigateParams,
  OkResult,
  OpenTabParams,
  OpenTabResult,
  SelectTabParams,
  SnapshotParams,
  SnapshotResult,
  TypeParams,
} from "./cdp.js";

describe("cdp schemas", () => {
  it("navigate params require a destination", () => {
    expect(NavigateParams.parse({ to: "https://x" }).to).toBe("https://x");
    expect(() => NavigateParams.parse({})).toThrow();
  });

  it("snapshot params default mode to a11y", () => {
    expect(SnapshotParams.parse({}).mode).toBe("a11y");
    expect(SnapshotParams.parse({ mode: "dom" }).mode).toBe("dom");
    expect(() => SnapshotParams.parse({ mode: "bogus" })).toThrow();
  });

  it("snapshot result carries content + refs", () => {
    const r = SnapshotResult.parse({
      content: "tree",
      refs: [{ ref: "e1", role: "button", name: "OK" }],
    });
    expect(r.refs[0]?.ref).toBe("e1");
  });

  it("click defaults button=left and clickCount=1", () => {
    const c = ClickParams.parse({ ref: "e1" });
    expect(c.button).toBe("left");
    expect(c.clickCount).toBe(1);
  });

  it("type requires text and defaults submit=false", () => {
    expect(TypeParams.parse({ ref: "e1", text: "hi" }).submit).toBe(false);
    expect(() => TypeParams.parse({ ref: "e1" })).toThrow();
  });

  it("OkResult accepts { ok: true }", () => {
    expect(OkResult.parse({ ok: true }).ok).toBe(true);
  });

  it("OpenTabParams requires a non-empty url and defaults activate to true", () => {
    expect(OpenTabParams.parse({ url: "https://x" }).activate).toBe(true);
    expect(OpenTabParams.parse({ url: "https://x", activate: false }).activate).toBe(false);
    expect(() => OpenTabParams.parse({})).toThrow();
    expect(() => OpenTabParams.parse({ url: "" })).toThrow();
  });

  it("OpenTabResult carries tabId", () => {
    expect(OpenTabResult.parse({ tabId: 42 }).tabId).toBe(42);
  });

  it("CloseTabParams requires tabId", () => {
    expect(CloseTabParams.parse({ tabId: 5 }).tabId).toBe(5);
    expect(() => CloseTabParams.parse({})).toThrow();
  });

  it("SelectTabParams requires tabId", () => {
    expect(SelectTabParams.parse({ tabId: 7 }).tabId).toBe(7);
    expect(() => SelectTabParams.parse({})).toThrow();
  });
});
