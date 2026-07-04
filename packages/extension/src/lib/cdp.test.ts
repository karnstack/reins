import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./monitor.js", () => ({ isMonitored: () => false }));

import { withDebugger } from "./cdp.js";

afterEach(() => vi.unstubAllGlobals());

/** chrome stub whose attach fails `failN` times before succeeding. */
function stubChrome(
  failN: number,
  error = "Cannot access a chrome-extension:// URL of different extension",
) {
  const attach = vi.fn(async () => {
    if (attach.mock.calls.length <= failN) throw new Error(error);
  });
  const detach = vi.fn(async () => {});
  vi.stubGlobal("chrome", { debugger: { attach, detach } });
  return { attach, detach };
}

describe("withDebugger attach retry", () => {
  it("attaches once, runs, detaches when there is no contention", async () => {
    const { attach, detach } = stubChrome(0);
    const result = await withDebugger(7, async () => "done");
    expect(result).toBe("done");
    expect(attach).toHaveBeenCalledTimes(1);
    expect(detach).toHaveBeenCalledTimes(1);
  });

  it("retries through the transient detach-in-flight error, then succeeds", async () => {
    const { attach, detach } = stubChrome(3);
    const result = await withDebugger(7, async () => "ok");
    expect(result).toBe("ok");
    expect(attach).toHaveBeenCalledTimes(4); // 3 transient failures + 1 success
    expect(detach).toHaveBeenCalledTimes(1);
  });

  it("gives up after maxTries and surfaces the error", async () => {
    const { attach } = stubChrome(99);
    await expect(withDebugger(7, async () => "never")).rejects.toThrow("different extension");
    expect(attach).toHaveBeenCalledTimes(6);
  });

  it("does not retry a non-transient attach error", async () => {
    const { attach } = stubChrome(99, "Cannot attach to the target: no such tab");
    // "cannot attach" IS transient by design (tab still settling), so pick a
    // genuinely fatal message to prove non-transient errors fail fast.
    attach.mockImplementation(async () => {
      throw new Error("Debugger is not allowed on this page");
    });
    await expect(withDebugger(7, async () => "x")).rejects.toThrow("not allowed");
    expect(attach).toHaveBeenCalledTimes(1);
  });
});
