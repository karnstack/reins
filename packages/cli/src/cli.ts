#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs, UsageError } from "./args.js";
import {
  browsersText,
  doctorReport,
  healthSummary,
  helpText,
  logsInfo,
  RESTART_WAIT_MS,
  rpcFailure,
  runRestart,
} from "./cli-commands.js";
import { TOOL_COMMANDS, type ToolCommand } from "./commands.js";
import { loadOrCreateConfig } from "./config.js";
import {
  ensureDaemon,
  findDaemon,
  probeHealth,
  restartDaemon,
  stopDaemon,
  waitForBrowsers,
} from "./ensure.js";
import { logsDir } from "./log.js";
import { packageVersion } from "./version.js";

const [command, ...rest] = process.argv.slice(2);

async function rpc(
  port: number,
  method: string,
  params: Record<string, unknown>,
  timeoutMs = 30_000,
): Promise<unknown> {
  const res = await fetch(`http://127.0.0.1:${port}/rpc`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ method, params }),
    signal: AbortSignal.timeout(timeoutMs),
  }).catch((err: unknown) => {
    throw rpcFailure(err, timeoutMs);
  });
  const body = (await res.json().catch(() => ({}))) as { result?: unknown; error?: string };
  if (!res.ok) throw new Error(body.error ?? `daemon replied ${res.status}`);
  return body.result;
}

function screenshotFile(out: string | undefined, format: string): string {
  if (out !== undefined) return resolve(out);
  const dir = join(homedir(), ".reins", "shots");
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return join(dir, `shot-${stamp}.${format === "jpeg" ? "jpg" : "png"}`);
}

async function runTool(name: string, cmd: ToolCommand, argv: string[]): Promise<void> {
  const a = parseArgs(argv, {
    booleans: [...(cmd.booleans ?? []), "json"],
    multi: cmd.multi,
  });
  const params = cmd.build(a);

  const ensured = await ensureDaemon(loadOrCreateConfig());
  if (ensured.health.browsers.length === 0) {
    if (!ensured.spawned) {
      throw new Error("no browser connected — is the reins extension installed? (`reins status`)");
    }
    // Fresh daemon: the extension's reconnect backoff caps at 10s — wait it out.
    await waitForBrowsers(ensured.port);
  }

  const result = await rpc(
    ensured.port,
    cmd.methodFor?.(params) ?? cmd.method,
    params,
    cmd.timeoutMs?.(params),
  );

  if (name === "screenshot") {
    const shot = result as { data: string; mimeType: string };
    const file = screenshotFile(
      typeof a.flags.out === "string" ? a.flags.out : undefined,
      shot.mimeType === "image/jpeg" ? "jpeg" : "png",
    );
    writeFileSync(file, Buffer.from(shot.data, "base64"));
    console.log(a.flags.json === true ? JSON.stringify({ file }) : file);
    return;
  }

  if (a.flags.json === true) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(cmd.format ? cmd.format(result, a) : JSON.stringify(result, null, 2));
  }
  const code = cmd.exitCode?.(result) ?? 0;
  if (code !== 0) process.exitCode = code;
}

async function main(): Promise<void> {
  const tool = command !== undefined ? TOOL_COMMANDS[command] : undefined;
  if (tool && command !== undefined) {
    await runTool(command, tool, rest);
    return;
  }

  switch (command) {
    case "daemon": {
      const { runDaemon } = await import("./serve.js");
      await runDaemon();
      break;
    }

    case "kill": {
      const found = await findDaemon(loadOrCreateConfig());
      if (!found) {
        console.log("no reins daemon running.");
        break;
      }
      await stopDaemon(found.port);
      console.log(`daemon on port ${found.port} stopped.`);
      break;
    }

    case "restart": {
      const { text, ok } = await runRestart({
        restart: () => restartDaemon(loadOrCreateConfig()),
        waitForBrowsers: (port) => waitForBrowsers(port, { timeoutMs: RESTART_WAIT_MS }),
        probe: probeHealth,
      });
      console.log(text);
      if (!ok) process.exitCode = 1;
      break;
    }

    case "extension": {
      const a = parseArgs(rest, { booleans: ["reload"] });
      const { bundledExtensionDir, extractExtension, sideloadInstructions } = await import(
        "./sideload.js"
      );
      const target = join(loadOrCreateConfig().dir, "extension");
      extractExtension(bundledExtensionDir(), target);
      if (a.flags.reload !== true) {
        console.log(sideloadInstructions(target));
        break;
      }
      // --reload: the staged build is already on disk; have the connected
      // unpacked extension re-read it (the chrome://extensions ⟳ click).
      console.log(`staged ${target}`);
      const ensured = await ensureDaemon(loadOrCreateConfig());
      if (ensured.health.browsers.length === 0) {
        if (!ensured.spawned) {
          throw new Error(
            "no browser connected — load the extension unpacked first (`reins extension`)",
          );
        }
        await waitForBrowsers(ensured.port);
      }
      const browser = typeof a.flags.browser === "string" ? a.flags.browser : undefined;
      // Wait for *this* browser to come back, not whichever reconnects first.
      const roster = ensured.health.browsers;
      const reloading =
        browser !== undefined
          ? roster.find((b) => b.id === browser)
          : roster.length === 1
            ? roster[0]
            : undefined;
      const { reloadExtension } = await import("./extension-cli.js");
      console.log(
        await reloadExtension(
          {
            rpc: (method, params) => rpc(ensured.port, method, params),
            waitReconnect: async (since) => {
              const name = reloading?.browser;
              const health = await waitForBrowsers(ensured.port, {
                connectedAfter: since,
                ...(name !== undefined ? { browser: name } : {}),
              });
              const fresh = health.browsers.find(
                (b) => b.connectedAt > since && (name === undefined || b.browser === name),
              );
              if (!fresh) throw new Error("the extension did not reconnect");
              return fresh;
            },
          },
          browser !== undefined ? { browserId: browser } : {},
        ),
      );
      break;
    }

    case "allow": {
      const id = rest[0];
      if (!id) throw new UsageError("usage: reins allow <extension-id>");
      const { allowExtension } = await import("./allowlist.js");
      allowExtension(loadOrCreateConfig().dir, id);
      console.log(`allowed ${id} — restart the daemon (\`reins restart\`) to pick it up.`);
      break;
    }

    case "policy": {
      const { runPolicy } = await import("./policy-cli.js");
      const ensured = await ensureDaemon(loadOrCreateConfig());
      if (ensured.health.browsers.length === 0) {
        if (!ensured.spawned) {
          throw new Error(
            "no browser connected — is the reins extension installed? (`reins status`)",
          );
        }
        await waitForBrowsers(ensured.port);
      }
      console.log(
        await runPolicy(rest, {
          rpc: (method, params) => rpc(ensured.port, method, params),
        }),
      );
      break;
    }

    case "key": {
      // Key methods are answered by the daemon itself — no browser needed.
      const { runKey } = await import("./key-cli.js");
      const { readSecret } = await import("./secret.js");
      const ensured = await ensureDaemon(loadOrCreateConfig());
      console.log(
        await runKey(rest, {
          rpc: (method, params) => rpc(ensured.port, method, params),
          readSecret,
        }),
      );
      break;
    }

    case "browsers": {
      const found = await findDaemon(loadOrCreateConfig());
      if (!found) {
        console.error("daemon not running — it starts on demand (`reins tabs`)");
        process.exitCode = 1;
        break;
      }
      console.log(browsersText(found.health.browsers));
      break;
    }

    case "status": {
      const cfg = loadOrCreateConfig();
      const found = await findDaemon(cfg);
      console.log(healthSummary(found?.health, found?.port ?? cfg.port, packageVersion()));
      console.log(`logs   : ${logsDir()}`);
      break;
    }

    case "doctor": {
      const cfg = loadOrCreateConfig();
      const found = await findDaemon(cfg);
      const report = doctorReport(cfg, found?.health, packageVersion());
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
        console.log(`No logs yet in ${info.dir} (the daemon writes there once it starts).`);
        break;
      }
      console.log(`${info.latest}\n`);
      for (const line of info.tail) console.log(line);
      break;
    }

    case "audit": {
      const { runAudit } = await import("./audit-cli.js");
      const view = runAudit(rest, { dir: logsDir(), now: () => new Date() });
      for (const w of view.warnings) console.error(w);
      console.log(view.out);
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
    case undefined: {
      const topic = rest[0] !== undefined ? TOOL_COMMANDS[rest[0]] : undefined;
      if (topic) {
        console.log(`${topic.usage}\n  ${topic.summary}`);
        break;
      }
      console.log(helpText(packageVersion(), TOOL_COMMANDS));
      break;
    }

    default:
      console.error(`unknown command: ${command}\n`);
      console.log(helpText(packageVersion(), TOOL_COMMANDS));
      process.exitCode = 1;
  }
}

try {
  await main();
} catch (err) {
  if (err instanceof UsageError && command !== undefined && TOOL_COMMANDS[command]) {
    console.error(`${err.message}\nusage: ${TOOL_COMMANDS[command].usage}`);
  } else {
    console.error(err instanceof Error ? err.message : String(err));
  }
  process.exitCode = 1;
}
