#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import {
  browsersText,
  claudeInstallArgs,
  codexSnippet,
  type DaemonHealth,
  doctorReport,
  healthSummary,
  helpText,
  installText,
  logsInfo,
  tabsText,
} from "./cli-commands.js";
import { candidatePorts, loadOrCreateConfig, type ReinsConfig } from "./config.js";
import { logsDir } from "./log.js";
import { packageVersion } from "./version.js";

const [command, ...rest] = process.argv.slice(2);

/** Probe one candidate port for a live reins daemon. */
async function probeHealth(
  port: number,
): Promise<{ port: number; health: DaemonHealth } | undefined> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(700),
    });
    if (!res.ok) return undefined;
    const health = (await res.json()) as DaemonHealth;
    return health.ok ? { port, health } : undefined;
  } catch {
    return undefined;
  }
}

/** Find the live daemon across the candidate ports (sticky port included). */
async function findDaemon(
  cfg: ReinsConfig,
): Promise<{ port: number; health: DaemonHealth } | undefined> {
  const results = await Promise.all(candidatePorts(cfg).map(probeHealth));
  return results.find((r) => r !== undefined);
}

function installClaude(port: number): number {
  const args = claudeInstallArgs(port);
  const res = spawnSync("claude", args, { stdio: "inherit" });
  if (res.error || res.status !== 0) {
    console.error(
      ["", "Could not run the claude CLI. Register manually:", `  claude ${args.join(" ")}`].join(
        "\n",
      ),
    );
    return 1;
  }
  console.log("\nreins registered with Claude Code (user scope).");
  console.log("Next: `reins up` (if not already) and install the browser extension.");
  return 0;
}

switch (command) {
  case "up": {
    const { serviceUp } = await import("./service.js");
    await serviceUp();
    // Give the service a beat to bind before reporting.
    await new Promise((r) => setTimeout(r, 800));
    const cfg = loadOrCreateConfig();
    const found = await findDaemon(cfg);
    console.log("reins daemon installed + started (autostarts on login).\n");
    console.log(healthSummary(found?.health, found?.port ?? cfg.port));
    console.log("\nNext: `reins install claude`, then add the browser extension.");
    break;
  }

  case "down": {
    const { serviceDown } = await import("./service.js");
    await serviceDown();
    console.log("reins daemon stopped and removed from autostart.");
    break;
  }

  case "restart": {
    const { serviceRestart } = await import("./service.js");
    await serviceRestart();
    console.log("reins daemon restarted.");
    break;
  }

  case "serve": {
    const { runDaemon } = await import("./serve.js");
    await runDaemon();
    break;
  }

  case "install": {
    const cfg = loadOrCreateConfig();
    const found = await findDaemon(cfg);
    const port = found?.port ?? cfg.port;
    const client = rest[0];
    if (client === "claude") {
      process.exitCode = installClaude(port);
    } else if (client === "codex") {
      console.log("Add to ~/.codex/config.toml:\n");
      console.log(codexSnippet(port));
    } else if (client === undefined) {
      console.log(installText(port));
    } else {
      console.error(`unknown client "${client}" — expected claude or codex\n`);
      console.log(installText(port));
      process.exitCode = 1;
    }
    break;
  }

  case "allow": {
    const id = rest[0];
    if (!id) {
      console.error("usage: reins allow <extension-id>");
      process.exitCode = 1;
      break;
    }
    const { allowExtension } = await import("./allowlist.js");
    allowExtension(loadOrCreateConfig().dir, id);
    console.log(`allowed ${id} — restart the daemon (\`reins restart\`) to pick it up.`);
    break;
  }

  case "browsers": {
    const found = await findDaemon(loadOrCreateConfig());
    if (!found) {
      console.error("daemon not running — `reins up`");
      process.exitCode = 1;
      break;
    }
    console.log(browsersText(found.health.browsers));
    break;
  }

  case "tabs": {
    const found = await findDaemon(loadOrCreateConfig());
    if (!found) {
      console.error("daemon not running — `reins up`");
      process.exitCode = 1;
      break;
    }
    const res = await fetch(`http://127.0.0.1:${found.port}/tabs`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      console.error(
        `could not list tabs: ${((await res.json().catch(() => ({}))) as { error?: string }).error ?? res.status}`,
      );
      process.exitCode = 1;
      break;
    }
    const { tabs } = (await res.json()) as { tabs: Parameters<typeof tabsText>[0] };
    const browserId = rest[0];
    console.log(tabsText(browserId ? tabs.filter((t) => t.browserId === browserId) : tabs));
    break;
  }

  case "status": {
    const cfg = loadOrCreateConfig();
    const found = await findDaemon(cfg);
    console.log(healthSummary(found?.health, found?.port ?? cfg.port));
    console.log(`logs   : ${logsDir()}`);
    break;
  }

  case "doctor": {
    const cfg = loadOrCreateConfig();
    const found = await findDaemon(cfg);
    const report = doctorReport(cfg, found?.health);
    for (const c of report.checks) {
      console.log(`${c.ok ? "✓" : "✗"} ${c.name}: ${c.detail}`);
    }
    console.log(report.ok ? "\nAll checks passed." : "\nSome checks failed.");
    process.exitCode = report.ok ? 0 : 1;
    break;
  }

  case "logs": {
    const info = logsInfo(logsDir());
    if (!info.latest) {
      console.log(`No logs yet in ${info.dir} (the server writes there once it starts).`);
      break;
    }
    console.log(`${info.latest}\n`);
    for (const line of info.tail) console.log(line);
    break;
  }

  case "version":
  case "--version":
  case "-v":
    console.log(packageVersion());
    break;

  case "help":
  case "--help":
  case "-h":
  case undefined:
    console.log(helpText(packageVersion()));
    break;

  default:
    console.error(`unknown command: ${command}\n`);
    console.log(helpText(packageVersion()));
    process.exitCode = 1;
}
