import { describe, expect, it } from "vitest";
import { parseArgs, UsageError } from "./args.js";

describe("parseArgs", () => {
  it("splits positionals and --flag value pairs", () => {
    const a = parseArgs(["https://x", "--tab", "12", "--browser", "b1"]);
    expect(a.positional).toEqual(["https://x"]);
    expect(a.flags).toEqual({ tab: "12", browser: "b1" });
  });

  it("supports --flag=value", () => {
    expect(parseArgs(["--tab=12"]).flags).toEqual({ tab: "12" });
    expect(parseArgs(["--text=a=b"]).flags).toEqual({ text: "a=b" });
  });

  it("treats declared booleans as valueless", () => {
    const a = parseArgs(["--full", "--tab", "3"], { booleans: ["full"] });
    expect(a.flags).toEqual({ full: true, tab: "3" });
  });

  it("collects multi flags into arrays", () => {
    const a = parseArgs(["--file", "a.pdf", "--file", "b.pdf"], { multi: ["file"] });
    expect(a.flags).toEqual({ file: ["a.pdf", "b.pdf"] });
  });

  it("throws UsageError when a value flag has no value", () => {
    expect(() => parseArgs(["--tab"])).toThrow(UsageError);
    expect(() => parseArgs(["--tab"])).toThrow("missing value for --tab");
  });

  it("keeps values that start with dashes when passed via =", () => {
    expect(parseArgs(["--by=-100,200"]).flags).toEqual({ by: "-100,200" });
  });
});
