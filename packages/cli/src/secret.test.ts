import { describe, expect, it } from "vitest";
import { feedSecret } from "./secret.js";

describe("feedSecret (raw-mode key entry)", () => {
  it("appends typed characters and submits on Enter", () => {
    expect(feedSecret("", "ab")).toEqual({ buf: "ab" });
    expect(feedSecret("ab", "c\r")).toEqual({ buf: "abc", end: "submit" });
    expect(feedSecret("ab", "\n")).toEqual({ buf: "ab", end: "submit" });
  });

  it("treats DEL and backspace as backspace", () => {
    expect(feedSecret("abc", "\u007f")).toEqual({ buf: "ab" });
    expect(feedSecret("abc", "\b")).toEqual({ buf: "ab" });
    expect(feedSecret("", "\b")).toEqual({ buf: "" });
  });

  it("Ctrl-D ends the input, or cancels when nothing was typed", () => {
    expect(feedSecret("abc", "\u0004")).toEqual({ buf: "abc", end: "submit" });
    expect(feedSecret("", "\u0004")).toEqual({ buf: "", end: "cancel" });
    expect(feedSecret("abc", "\u0004")).not.toMatchObject({ buf: "abc\u0004" });
  });

  it("Ctrl-C cancels", () => {
    expect(feedSecret("abc", "\u0003")).toEqual({ buf: "abc", end: "cancel" });
  });

  it("stops at the first terminator in a pasted chunk", () => {
    expect(feedSecret("", "key\rjunk")).toEqual({ buf: "key", end: "submit" });
  });
});
