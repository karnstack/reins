import { describe, expect, it } from "vitest";
import {
  CdpParams,
  ClickParams,
  CloseTabParams,
  ConsoleEntry,
  ConsoleParams,
  ConsoleResult,
  DialogParams,
  EvalParams,
  EvalResult,
  FillParams,
  HoverParams,
  NavigateParams,
  NetworkEntry,
  NetworkParams,
  NetworkResult,
  OkResult,
  OpenTabParams,
  OpenTabResult,
  PressKeyParams,
  ReadTextParams,
  ResizeParams,
  ScreenshotParams,
  ScreenshotResult,
  ScrollParams,
  SelectOptionParams,
  SelectTabParams,
  SnapshotParams,
  SnapshotResult,
  TypeParams,
  UploadParams,
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

describe("page-control schemas", () => {
  it("press_key requires a non-empty key spec", () => {
    expect(PressKeyParams.parse({ key: "Escape" }).key).toBe("Escape");
    expect(PressKeyParams.parse({ key: "Meta+A", tabId: 3 }).tabId).toBe(3);
    expect(() => PressKeyParams.parse({ key: "" })).toThrow();
    expect(() => PressKeyParams.parse({})).toThrow();
  });

  it("hover requires a ref or a selector", () => {
    expect(HoverParams.parse({ ref: "e1" }).ref).toBe("e1");
    expect(HoverParams.parse({ selector: "#x" }).selector).toBe("#x");
    expect(() => HoverParams.parse({})).toThrow("hover requires a ref or a selector");
  });

  it("scroll requires some target or motion", () => {
    expect(ScrollParams.parse({ ref: "e2" }).ref).toBe("e2");
    expect(ScrollParams.parse({ by: { dx: 0, dy: 600 } }).by).toEqual({ dx: 0, dy: 600 });
    expect(ScrollParams.parse({ to: "bottom" }).to).toBe("bottom");
    expect(() => ScrollParams.parse({})).toThrow("scroll requires a ref, a selector, by, or to");
    expect(() => ScrollParams.parse({ to: "middle" })).toThrow();
  });

  it("fill requires a target and a value", () => {
    expect(FillParams.parse({ ref: "e1", value: "x" }).value).toBe("x");
    expect(() => FillParams.parse({ value: "x" })).toThrow("fill requires a ref or a selector");
    expect(() => FillParams.parse({ ref: "e1" })).toThrow();
  });

  it("select requires a target and a value", () => {
    expect(SelectOptionParams.parse({ selector: "select", value: "IN" }).value).toBe("IN");
    expect(() => SelectOptionParams.parse({ value: "IN" })).toThrow(
      "select requires a ref or a selector",
    );
  });

  it("upload requires a target and at least one file", () => {
    const p = UploadParams.parse({ ref: "e1", files: ["/tmp/a.pdf"] });
    expect(p.files).toEqual(["/tmp/a.pdf"]);
    expect(() => UploadParams.parse({ ref: "e1", files: [] })).toThrow();
    expect(() => UploadParams.parse({ files: ["/tmp/a"] })).toThrow(
      "upload requires a ref or a selector",
    );
  });

  it("read_text works without a target (whole page)", () => {
    expect(ReadTextParams.parse({}).ref).toBeUndefined();
    expect(ReadTextParams.parse({ selector: "main", maxChars: 500 }).maxChars).toBe(500);
    expect(() => ReadTextParams.parse({ maxChars: 0 })).toThrow();
  });

  it("resize requires positive integer dimensions", () => {
    const p = ResizeParams.parse({ width: 1280, height: 800 });
    expect(p.width).toBe(1280);
    expect(() => ResizeParams.parse({ width: 1280 })).toThrow();
    expect(() => ResizeParams.parse({ width: 0, height: 800 })).toThrow();
  });

  it("dialog requires accept and takes optional promptText", () => {
    expect(DialogParams.parse({ accept: true }).accept).toBe(true);
    expect(DialogParams.parse({ accept: false, promptText: "hi" }).promptText).toBe("hi");
    expect(() => DialogParams.parse({})).toThrow();
  });

  it("cdp requires Domain.method format", () => {
    const p = CdpParams.parse({ method: "Page.captureScreenshot", params: { format: "png" } });
    expect(p.method).toBe("Page.captureScreenshot");
    expect(() => CdpParams.parse({ method: "captureScreenshot" })).toThrow(
      "expected Domain.method",
    );
    expect(() => CdpParams.parse({ method: "Page.capture.Screenshot" })).toThrow();
  });
});

describe("ConsoleEntry schema", () => {
  it("validates a complete entry", () => {
    const e = ConsoleEntry.parse({ level: "log", text: "hello", timestamp: 1234567890 });
    expect(e.level).toBe("log");
    expect(e.text).toBe("hello");
    expect(e.timestamp).toBe(1234567890);
  });

  it("accepts any non-empty level string (permissive)", () => {
    expect(ConsoleEntry.parse({ level: "warning", text: "x", timestamp: 0 }).level).toBe("warning");
    expect(ConsoleEntry.parse({ level: "debug", text: "x", timestamp: 0 }).level).toBe("debug");
    expect(ConsoleEntry.parse({ level: "error", text: "x", timestamp: 0 }).level).toBe("error");
  });

  it("rejects missing required fields", () => {
    expect(() => ConsoleEntry.parse({ level: "log", text: "x" })).toThrow();
    expect(() => ConsoleEntry.parse({ level: "log", timestamp: 0 })).toThrow();
    expect(() => ConsoleEntry.parse({ text: "x", timestamp: 0 })).toThrow();
  });
});

describe("NetworkEntry schema", () => {
  it("validates a complete entry with status", () => {
    const e = NetworkEntry.parse({
      method: "GET",
      url: "https://x.com",
      status: 200,
      timestamp: 1,
    });
    expect(e.method).toBe("GET");
    expect(e.url).toBe("https://x.com");
    expect(e.status).toBe(200);
    expect(e.timestamp).toBe(1);
  });

  it("status is optional", () => {
    const e = NetworkEntry.parse({ method: "POST", url: "https://y.com", timestamp: 2 });
    expect(e.status).toBeUndefined();
  });

  it("rejects missing required fields", () => {
    expect(() => NetworkEntry.parse({ url: "https://x.com", timestamp: 0 })).toThrow();
    expect(() => NetworkEntry.parse({ method: "GET", timestamp: 0 })).toThrow();
    expect(() => NetworkEntry.parse({ method: "GET", url: "https://x.com" })).toThrow();
  });
});

describe("ConsoleParams schema", () => {
  it("accepts empty object (all fields optional)", () => {
    const p = ConsoleParams.parse({});
    expect(p.tabId).toBeUndefined();
    expect(p.sinceMs).toBeUndefined();
    expect(p.levels).toBeUndefined();
  });

  it("accepts all optional fields", () => {
    const p = ConsoleParams.parse({ tabId: 1, sinceMs: 5000, levels: ["log", "error"] });
    expect(p.tabId).toBe(1);
    expect(p.sinceMs).toBe(5000);
    expect(p.levels).toEqual(["log", "error"]);
  });
});

describe("NetworkParams schema", () => {
  it("accepts empty object (all fields optional)", () => {
    const p = NetworkParams.parse({});
    expect(p.tabId).toBeUndefined();
    expect(p.sinceMs).toBeUndefined();
    expect(p.urlPattern).toBeUndefined();
  });

  it("accepts all optional fields", () => {
    const p = NetworkParams.parse({ tabId: 2, sinceMs: 1000, urlPattern: "*/api/*" });
    expect(p.tabId).toBe(2);
    expect(p.sinceMs).toBe(1000);
    expect(p.urlPattern).toBe("*/api/*");
  });
});

describe("ConsoleResult schema", () => {
  it("wraps an array of ConsoleEntry", () => {
    const r = ConsoleResult.parse({
      entries: [{ level: "info", text: "msg", timestamp: 10 }],
    });
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0]?.level).toBe("info");
  });

  it("accepts empty entries array", () => {
    expect(ConsoleResult.parse({ entries: [] }).entries).toEqual([]);
  });

  it("rejects missing entries", () => {
    expect(() => ConsoleResult.parse({})).toThrow();
  });
});

describe("NetworkResult schema", () => {
  it("wraps an array of NetworkEntry", () => {
    const r = NetworkResult.parse({
      entries: [{ method: "GET", url: "https://a.com", status: 200, timestamp: 5 }],
    });
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0]?.url).toBe("https://a.com");
  });

  it("accepts empty entries array", () => {
    expect(NetworkResult.parse({ entries: [] }).entries).toEqual([]);
  });

  it("rejects missing entries", () => {
    expect(() => NetworkResult.parse({})).toThrow();
  });
});
