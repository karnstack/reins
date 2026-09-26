import { describe, expect, it, vi } from "vitest";
import { reloadExtension } from "./extension-cli.js";

describe("reloadExtension", () => {
  it("asks the extension to reload, then waits for a fresh connection", async () => {
    const rpc = vi.fn(async () => ({ reloading: true, version: "0.4.0" }));
    const waitReconnect = vi.fn(async (since: number) => {
      expect(since).toBeGreaterThan(0);
      return { id: "b2", browser: "Google Chrome", connectedAt: since + 1 };
    });
    const out = await reloadExtension({ rpc, waitReconnect }, { browserId: "b1" });
    expect(rpc).toHaveBeenCalledWith("extension_reload", { browserId: "b1" });
    expect(out).toBe("reloaded the reins extension (0.4.0) — reconnected as b2 (Google Chrome)");
  });

  it("passes the extension's refusal through (store builds update themselves)", async () => {
    const rpc = vi.fn(async () => {
      throw new Error("reload is for unpacked builds");
    });
    const waitReconnect = vi.fn();
    await expect(reloadExtension({ rpc, waitReconnect }, {})).rejects.toThrow(
      "reload is for unpacked builds",
    );
    expect(waitReconnect).not.toHaveBeenCalled();
  });

  it("says what happened when the reloaded extension doesn't reconnect", async () => {
    const rpc = vi.fn(async () => ({ reloading: true, version: "0.4.0" }));
    const waitReconnect = vi.fn(async () => {
      throw new Error("no browser connected — is the reins extension installed? (`reins status`)");
    });
    await expect(reloadExtension({ rpc, waitReconnect }, {})).rejects.toThrow(
      /reloaded, but hasn't reconnected.*⟳ Reload/s,
    );
  });
});
