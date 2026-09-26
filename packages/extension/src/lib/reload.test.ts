import { afterEach, describe, expect, it, vi } from "vitest";
import { reloadExtension } from "./reload.js";

function stubChrome(installType: string) {
  const reload = vi.fn();
  vi.stubGlobal("chrome", {
    management: { getSelf: async () => ({ installType, version: "0.4.0" }) },
    runtime: { reload },
  });
  return reload;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("reloadExtension", () => {
  it("reloads an unpacked build — after replying, so the answer gets out", async () => {
    vi.useFakeTimers();
    const reload = stubChrome("development");
    expect(await reloadExtension()).toEqual({ reloading: true, version: "0.4.0" });
    expect(reload).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(500);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("refuses on a Chrome Web Store build, which updates itself", async () => {
    const reload = stubChrome("normal");
    await expect(reloadExtension()).rejects.toThrow(/unpacked.*Chrome Web Store/s);
    expect(reload).not.toHaveBeenCalled();
  });
});
