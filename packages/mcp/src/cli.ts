#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { connect } from "node:net";
import {
  claudeInstallArgs,
  codexSnippet,
  doctorReport,
  helpText,
  installText,
  logsInfo,
  pairText,
} from "./cli-commands.js";
import { loadOrCreateConfig } from "./config.js";
import { logsDir } from "./log.js";
import { packageVersion } from "./version.js";

const [command, ...rest] = process.argv.slice(2);

/** True if something is listening on the bridge port (a running reins-mcp). */
function probePort(port: number, timeoutMs = 500): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: "127.0.0.1", port });
    const done = (up: boolean) => {
      socket.destroy();
      resolve(up);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.on("connect", () => done(true));
    socket.on("error", () => done(false));
  });
}

function installClaude(): number {
  const args = claudeInstallArgs();
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
  console.log("Next: load the extension and run `reins pair` to connect the browser.");
  return 0;
}

switch (command) {
  case "pair":
    console.log(pairText(loadOrCreateConfig()));
    break;

  case "doctor": {
    const report = doctorReport(loadOrCreateConfig());
    for (const c of report.checks) {
      console.log(`${c.ok ? "✓" : "✗"} ${c.name}: ${c.detail}`);
    }
    console.log(report.ok ? "\nAll checks passed." : "\nSome checks failed.");
    process.exitCode = report.ok ? 0 : 1;
    break;
  }

  case "status": {
    const cfg = loadOrCreateConfig();
    const up = await probePort(cfg.port);
    console.log(
      [
        `config : ${cfg.dir}`,
        `port   : ${cfg.port}`,
        `server : ${up ? "running (bridge port is listening)" : "not running (starts with your MCP client)"}`,
        `logs   : ${logsDir()}`,
      ].join("\n"),
    );
    break;
  }

  case "install": {
    const client = rest[0];
    if (client === "claude") {
      process.exitCode = installClaude();
    } else if (client === "codex") {
      console.log("Add to ~/.codex/config.toml:\n");
      console.log(codexSnippet());
    } else if (client === undefined) {
      console.log(installText());
    } else {
      console.error(`unknown client "${client}" — expected claude or codex\n`);
      console.log(installText());
      process.exitCode = 1;
    }
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
