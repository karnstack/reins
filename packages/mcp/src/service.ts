import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { logsDir } from "./log.js";

const LABEL = "com.karnstack.reins";

export function launchdPlist(opts: { node: string; cliJs: string; logsDir: string }): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${opts.node}</string>
    <string>${opts.cliJs}</string>
    <string>serve</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${opts.logsDir}/daemon.out.log</string>
  <key>StandardErrorPath</key><string>${opts.logsDir}/daemon.err.log</string>
</dict>
</plist>
`;
}

export function systemdUnit(opts: { node: string; cliJs: string }): string {
  return `[Unit]
Description=reins MCP daemon

[Service]
ExecStart=${opts.node} ${opts.cliJs} serve
Restart=on-failure

[Install]
WantedBy=default.target
`;
}

export function servicePaths(
  platform: NodeJS.Platform,
  home: string,
): { path: string; kind: "launchd" | "systemd" } | undefined {
  if (platform === "darwin") {
    return { path: join(home, "Library", "LaunchAgents", `${LABEL}.plist`), kind: "launchd" };
  }
  if (platform === "linux") {
    return { path: join(home, ".config", "systemd", "user", "reins.service"), kind: "systemd" };
  }
  return undefined;
}

function target() {
  const svc = servicePaths(process.platform, homedir());
  if (!svc) {
    throw new Error(
      `service management is not supported on ${process.platform}; run \`reins serve\` in the foreground or use \`reins serve --stdio\``,
    );
  }
  return svc;
}

function cliJsPath(): string {
  // This module lands in dist/ next to cli.js after bundling.
  return join(dirname(fileURLToPath(import.meta.url)), "cli.js");
}

function launchdDomain(): string {
  return `gui/${process.getuid?.() ?? 501}`;
}

export async function serviceUp(): Promise<void> {
  const svc = target();
  const opts = { node: process.execPath, cliJs: cliJsPath(), logsDir: logsDir() };
  mkdirSync(dirname(svc.path), { recursive: true });
  mkdirSync(opts.logsDir, { recursive: true });
  if (svc.kind === "launchd") {
    writeFileSync(svc.path, launchdPlist(opts));
    try {
      execFileSync("launchctl", ["bootout", launchdDomain(), svc.path], { stdio: "ignore" });
    } catch {
      // not loaded — fine
    }
    execFileSync("launchctl", ["bootstrap", launchdDomain(), svc.path], { stdio: "inherit" });
  } else {
    writeFileSync(svc.path, systemdUnit(opts));
    execFileSync("systemctl", ["--user", "daemon-reload"], { stdio: "inherit" });
    execFileSync("systemctl", ["--user", "enable", "--now", "reins"], { stdio: "inherit" });
  }
}

export async function serviceDown(): Promise<void> {
  const svc = target();
  if (svc.kind === "launchd") {
    try {
      execFileSync("launchctl", ["bootout", launchdDomain(), svc.path], { stdio: "ignore" });
    } catch {
      // not loaded
    }
  } else {
    try {
      execFileSync("systemctl", ["--user", "disable", "--now", "reins"], { stdio: "ignore" });
    } catch {
      // not enabled
    }
  }
  rmSync(svc.path, { force: true });
}

export async function serviceRestart(): Promise<void> {
  await serviceDown();
  await serviceUp();
}
