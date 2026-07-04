import { isAbsolute } from "node:path";
import { describe, expect, it } from "vitest";
import { parseArgs, UsageError } from "./args.js";
import { TOOL_COMMANDS, type ToolCommand } from "./commands.js";

function cmd(name: string): ToolCommand {
  const c = TOOL_COMMANDS[name];
  if (!c) throw new Error(`no such command: ${name}`);
  return c;
}

/** Parse argv exactly like the CLI runner does for this command. */
function build(name: string, argv: string[]): Record<string, unknown> {
  const c = cmd(name);
  return c.build(parseArgs(argv, { booleans: [...(c.booleans ?? []), "json"], multi: c.multi }));
}

function format(name: string, result: unknown, argv: string[] = []): string {
  const c = cmd(name);
  const formatted = c.format?.(result, parseArgs(argv));
  if (formatted === undefined) throw new Error(`${name} has no format`);
  return formatted;
}

describe("TOOL_COMMANDS: params", () => {
  it("every command has a usage line and a summary", () => {
    for (const [name, c] of Object.entries(TOOL_COMMANDS)) {
      expect(c.usage, name).toContain(`reins ${name}`);
      expect(c.summary.length, name).toBeGreaterThan(0);
    }
  });

  it("shared flags: --tab and --browser flow into tabId/browserId", () => {
    expect(build("click", ["--ref", "e5", "--tab", "12", "--browser", "b2"])).toEqual({
      ref: "e5",
      tabId: 12,
      browserId: "b2",
    });
    expect(() => build("click", ["--ref", "e5", "--tab", "twelve"])).toThrow(UsageError);
  });

  it("tabs: optional browser filter, no tab flag", () => {
    expect(build("tabs", [])).toEqual({});
    expect(build("tabs", ["--browser", "b1"])).toEqual({ browserId: "b1" });
  });

  it("open: url positional, --background flips activate", () => {
    expect(build("open", ["https://x"])).toEqual({ url: "https://x", activate: true });
    expect(build("open", ["https://x", "--background"])).toEqual({
      url: "https://x",
      activate: false,
    });
    expect(() => build("open", [])).toThrow("a URL argument is required");
  });

  it("close/focus require --tab", () => {
    expect(build("close", ["--tab", "3"])).toEqual({ tabId: 3 });
    expect(build("focus", ["--tab", "4"])).toEqual({ tabId: 4 });
    expect(() => build("close", [])).toThrow("--tab is required");
  });

  it("nav: destination positional", () => {
    expect(build("nav", ["back", "--tab", "2"])).toEqual({ to: "back", tabId: 2 });
    expect(() => build("nav", [])).toThrow("destination");
  });

  it("click: target required, button/count validated", () => {
    expect(build("click", ["--ref", "e1", "--button", "right", "--count", "2"])).toEqual({
      ref: "e1",
      button: "right",
      clickCount: 2,
    });
    expect(() => build("click", [])).toThrow("--ref or --selector is required");
    expect(() => build("click", ["--ref", "e1", "--button", "top"])).toThrow(
      "--button must be one of left|right|middle",
    );
  });

  it("type: --text required, --enter → submit", () => {
    expect(build("type", ["--ref", "e1", "--text", "hi", "--enter"])).toEqual({
      ref: "e1",
      text: "hi",
      submit: true,
    });
    expect(build("type", ["--selector", "#q", "--text", ""])).toEqual({
      selector: "#q",
      text: "",
      submit: false,
    });
  });

  it("press: --key required", () => {
    expect(build("press", ["--key", "Meta+A"])).toEqual({ key: "Meta+A" });
    expect(() => build("press", [])).toThrow("--key is required");
  });

  it("scroll: --by parses dx,dy; needs some target or motion", () => {
    expect(build("scroll", ["--by", "0,600"])).toEqual({ by: { dx: 0, dy: 600 } });
    expect(build("scroll", ["--by=-10,-20"])).toEqual({ by: { dx: -10, dy: -20 } });
    expect(build("scroll", ["--to", "bottom"])).toEqual({ to: "bottom" });
    expect(build("scroll", ["--ref", "e2"])).toEqual({ ref: "e2" });
    expect(() => build("scroll", [])).toThrow("scroll needs");
    expect(() => build("scroll", ["--by", "abc"])).toThrow('--by must be "dx,dy"');
    expect(() => build("scroll", ["--to", "middle"])).toThrow("--to must be one of top|bottom");
  });

  it("fill/select: target + --value required", () => {
    expect(build("fill", ["--ref", "e1", "--value", "Karn"])).toEqual({ ref: "e1", value: "Karn" });
    expect(build("select", ["--selector", "select", "--value", "IN"])).toEqual({
      selector: "select",
      value: "IN",
    });
    expect(() => build("fill", ["--ref", "e1"])).toThrow("--value is required");
  });

  it("upload: repeatable --file, resolved to absolute paths", () => {
    const params = build("upload", ["--ref", "e1", "--file", "a.pdf", "--file", "/tmp/b.pdf"]);
    const files = params.files as string[];
    expect(files).toHaveLength(2);
    expect(files.every((f) => isAbsolute(f))).toBe(true);
    expect(files[1]).toBe("/tmp/b.pdf");
    expect(() => build("upload", ["--ref", "e1"])).toThrow("--file <path> is required");
  });

  it("text: optional target and max-chars", () => {
    expect(build("text", [])).toEqual({});
    expect(build("text", ["--selector", "main", "--max-chars", "500"])).toEqual({
      selector: "main",
      maxChars: 500,
    });
  });

  it("screenshot: --full and --format", () => {
    expect(build("screenshot", [])).toEqual({ fullPage: false });
    expect(build("screenshot", ["--full", "--format", "jpeg"])).toEqual({
      fullPage: true,
      format: "jpeg",
    });
    expect(() => build("screenshot", ["--format", "gif"])).toThrow(
      "--format must be one of png|jpeg",
    );
  });

  it("eval: expression positional, --await", () => {
    expect(build("eval", ["1+1", "--await"])).toEqual({ expression: "1+1", awaitPromise: true });
    expect(() => build("eval", [])).toThrow("an expression argument is required");
  });

  it("wait: target required, state/timeout validated", () => {
    expect(build("wait", ["--selector", "#ok", "--state", "hidden", "--timeout", "9000"])).toEqual({
      selector: "#ok",
      state: "hidden",
      timeoutMs: 9000,
    });
    expect(() => build("wait", ["--selector", "#ok", "--state", "gone"])).toThrow(
      "--state must be one of visible|hidden|present",
    );
  });

  it("console/network: filters map to sinceMs/levels/urlPattern", () => {
    expect(build("console", ["--since", "5000", "--level", "error", "--level", "warning"])).toEqual(
      { sinceMs: 5000, levels: ["error", "warning"] },
    );
    expect(build("network", ["--since", "1000", "--url", "*/api/*"])).toEqual({
      sinceMs: 1000,
      urlPattern: "*/api/*",
    });
  });

  it("resize: width and height required", () => {
    expect(build("resize", ["--width", "1280", "--height", "800"])).toEqual({
      width: 1280,
      height: 800,
    });
    expect(() => build("resize", ["--width", "1280"])).toThrow("--height is required");
  });

  it("dialog: exactly one of --accept/--dismiss", () => {
    expect(build("dialog", ["--accept"])).toEqual({ accept: true });
    expect(build("dialog", ["--dismiss", "--text", "name"])).toEqual({
      accept: false,
      promptText: "name",
    });
    expect(() => build("dialog", [])).toThrow("exactly one of --accept / --dismiss");
    expect(() => build("dialog", ["--accept", "--dismiss"])).toThrow(
      "exactly one of --accept / --dismiss",
    );
  });

  it("cdp: Domain.method positional + optional JSON object params", () => {
    expect(build("cdp", ["Page.enable"])).toEqual({ method: "Page.enable" });
    expect(build("cdp", ["Network.setCookie", '{"name":"a","value":"b"}'])).toEqual({
      method: "Network.setCookie",
      params: { name: "a", value: "b" },
    });
    expect(() => build("cdp", [])).toThrow("Domain.method argument is required");
    expect(() => build("cdp", ["Page.enable", "not json"])).toThrow("must be valid JSON");
    expect(() => build("cdp", ["Page.enable", "[1,2]"])).toThrow("must be a JSON object");
  });
});

describe("TOOL_COMMANDS: formatting", () => {
  it("tabs renders the tagged tab table", () => {
    const out = format("tabs", {
      tabs: [{ tabId: 3, title: "Home", url: "https://x", active: true, browserId: "b1" }],
    });
    expect(out).toContain("b1");
    expect(out).toContain("tab 3 *");
  });

  it("open/nav/eval/text/cdp print their payloads", () => {
    expect(format("open", { tabId: 7 })).toBe("opened tab 7");
    expect(format("nav", { url: "https://x/" })).toBe("→ https://x/");
    expect(format("eval", { value: { a: 1 } })).toBe(JSON.stringify({ a: 1 }, null, 2));
    expect(format("text", { text: "hello" })).toBe("hello");
    expect(format("cdp", { result: { frameId: "F1" } })).toBe(
      JSON.stringify({ frameId: "F1" }, null, 2),
    );
  });

  it("snapshot prints content, or a hint when empty", () => {
    expect(format("snapshot", { content: "e1: button OK", refs: [{ ref: "e1" }] })).toBe(
      "e1: button OK",
    );
    expect(format("snapshot", { content: "", refs: [] })).toBe("(no interactive elements found)");
  });

  it("console/network render entry lines and empty hints", () => {
    expect(format("console", { entries: [{ level: "error", text: "boom", timestamp: 1 }] })).toBe(
      "[error] boom",
    );
    expect(format("console", { entries: [] })).toBe("(no console entries)");
    expect(
      format("network", {
        entries: [{ method: "GET", url: "https://x", status: 200, timestamp: 1 }],
      }),
    ).toBe("GET https://x -> 200");
    expect(format("network", { entries: [] })).toBe("(no network entries)");
  });

  it("ok-style commands print ok", () => {
    for (const name of [
      "click",
      "type",
      "press",
      "hover",
      "scroll",
      "fill",
      "select",
      "upload",
      "wait",
      "resize",
      "dialog",
      "close",
      "focus",
    ]) {
      expect(format(name, { ok: true }), name).toBe("ok");
    }
  });

  it("screenshot leaves output to the runner (file write)", () => {
    expect(cmd("screenshot").format).toBeUndefined();
  });
});
