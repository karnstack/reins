import { describe, expect, it } from "vitest";
import { launchdPlist, servicePaths, systemdUnit } from "./service.js";

const OPTS = {
  node: "/usr/local/bin/node",
  cliJs: "/x/dist/cli.js",
  logsDir: "/home/u/.reins/logs",
};

describe("launchdPlist", () => {
  it("runs `node cli.js serve`, keeps alive, and captures stderr", () => {
    const plist = launchdPlist(OPTS);
    expect(plist).toContain("<string>/usr/local/bin/node</string>");
    expect(plist).toContain("<string>/x/dist/cli.js</string>");
    expect(plist).toContain("<string>serve</string>");
    expect(plist).toContain("com.karnstack.reins");
    expect(plist).toContain("<key>KeepAlive</key>");
    expect(plist).toContain("/home/u/.reins/logs/daemon.err.log");
  });
});

describe("systemdUnit", () => {
  it("execs `node cli.js serve` and restarts on failure", () => {
    const unit = systemdUnit(OPTS);
    expect(unit).toContain("ExecStart=/usr/local/bin/node /x/dist/cli.js serve");
    expect(unit).toContain("Restart=on-failure");
    expect(unit).toContain("WantedBy=default.target");
  });
});

describe("servicePaths", () => {
  it("darwin → LaunchAgents plist", () => {
    expect(servicePaths("darwin", "/Users/u")).toEqual({
      path: "/Users/u/Library/LaunchAgents/com.karnstack.reins.plist",
      kind: "launchd",
    });
  });
  it("linux → systemd user unit", () => {
    expect(servicePaths("linux", "/home/u")).toEqual({
      path: "/home/u/.config/systemd/user/reins.service",
      kind: "systemd",
    });
  });
  it("win32 → undefined", () => {
    expect(servicePaths("win32", "C:\\Users\\u")).toBeUndefined();
  });
});
