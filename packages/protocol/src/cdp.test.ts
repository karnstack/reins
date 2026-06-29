import { describe, expect, it } from "vitest";
import {
  ClickParams,
  CloseTabParams,
  EvalParams,
  EvalResult,
  NavigateParams,
  OkResult,
  OpenTabParams,
  OpenTabResult,
  ScreenshotParams,
  ScreenshotResult,
  SelectTabParams,
  SnapshotParams,
  SnapshotResult,
  TypeParams,
  WaitForParams,
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

  it("ScreenshotParams defaults fullPage=false and format=png", () => {
    const p = ScreenshotParams.parse({});
    expect(p.fullPage).toBe(false);
    expect(p.format).toBe("png");
  });

  it("ScreenshotParams rejects an invalid format enum", () => {
    expect(() => ScreenshotParams.parse({ format: "gif" })).toThrow();
  });

  it("ScreenshotResult carries data and mimeType", () => {
    const r = ScreenshotResult.parse({ data: "abc123", mimeType: "image/png" });
    expect(r.data).toBe("abc123");
    expect(r.mimeType).toBe("image/png");
  });

  it("EvalParams requires a non-empty expression", () => {
    expect(() => EvalParams.parse({ expression: "" })).toThrow();
    expect(EvalParams.parse({ expression: "1+1" }).expression).toBe("1+1");
  });

  it("EvalParams defaults awaitPromise=false", () => {
    expect(EvalParams.parse({ expression: "1" }).awaitPromise).toBe(false);
  });

  it("EvalResult carries an unknown value", () => {
    expect(EvalResult.parse({ value: 42 }).value).toBe(42);
    expect(EvalResult.parse({ value: null }).value).toBeNull();
  });

  it("WaitForParams defaults state=visible and timeoutMs=5000", () => {
    const p = WaitForParams.parse({ selector: "#foo" });
    expect(p.state).toBe("visible");
    expect(p.timeoutMs).toBe(5000);
  });

  it("WaitForParams throws when neither ref nor selector is given", () => {
    expect(() => WaitForParams.parse({})).toThrow("wait_for requires a ref or a selector");
  });

  it("WaitForParams accepts ref without selector", () => {
    const p = WaitForParams.parse({ ref: "e1" });
    expect(p.ref).toBe("e1");
  });
});
