import { loadAllowedOrigins } from "./allowlist.js";
import { createAuditor, pruneAuditLogs } from "./audit.js";
import { BridgeHost } from "./bridge.js";
import { candidatePorts, loadOrCreateConfig, recordPort } from "./config.js";
import { type Daemon, startDaemon } from "./daemon.js";
import { type FoundDaemon, probeHealth } from "./ensure.js";
import { handleDo } from "./jev/do.js";
import { createKeyService } from "./jev/keys.js";
import { RunStore } from "./jev/runs.js";
import { fileTraceSink } from "./jev/trace.js";
import { createLogger, type Log, logsDir } from "./log.js";
import { handleRpc } from "./rpc.js";

/** First live daemon on a lower candidate port than ours, if any. Two racing
 *  CLI spawns can bind different candidates; the lower port deterministically
 *  wins and the higher one bows out. */
export async function lowerPortRival(
  ports: number[],
  ownPort: number,
  probe: (port: number) => Promise<FoundDaemon | undefined> = probeHealth,
): Promise<number | undefined> {
  const rivals = await Promise.all(ports.filter((p) => p < ownPort).map((p) => probe(p)));
  return rivals.find((r) => r !== undefined)?.port;
}

function isAddrInUse(err: unknown): boolean {
  return (err as NodeJS.ErrnoException | undefined)?.code === "EADDRINUSE";
}

/** Try candidates in order (sticky port first); skip busy ports unless pinned. */
async function bindFirstFree<T>(
  ports: number[],
  log: Log,
  bind: (port: number) => Promise<T>,
): Promise<T> {
  let lastErr: unknown;
  for (const port of ports) {
    try {
      return await bind(port);
    } catch (err) {
      lastErr = err;
      if (!isAddrInUse(err)) throw err;
      log(`reins: port ${port} is busy, trying the next candidate`);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** `reins daemon` — the foreground daemon (the CLI spawns this detached). */
export async function runDaemon(): Promise<void> {
  const log = createLogger();
  const config = loadOrCreateConfig();
  const audit = createAuditor(logsDir(), { log });
  const pruned = pruneAuditLogs(logsDir(), new Date());
  if (pruned.length > 0) log(`reins: pruned ${pruned.length} audit file(s) older than 30 days`);
  const keys = createKeyService({ dir: config.dir });
  const runs = new RunStore();
  // Opt-in `reins do` diagnostics: one JSON line per Jev call (question keys,
  // probabilities, chosen targets, tokens — never page text or the key).
  const traceFile = process.env.REINS_JEV_TRACE;
  const trace = traceFile ? fileTraceSink(traceFile) : undefined;
  if (trace) log(`reins: writing Jev trace lines to ${traceFile}`);
  const bridge: BridgeHost = new BridgeHost({
    allowedOrigins: loadAllowedOrigins(config.dir),
    log,
    // Popup key saves go through the same audited path as `reins key`.
    onCall: (method, params) => handleRpc(bridge, { method, params }, audit, { keys }),
  });
  const ports = candidatePorts(config);

  let shuttingDown = false;
  const shutdown = async (reason: string, cleanup: () => Promise<void>) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`reins: shutting down (${reason})`);
    await cleanup().catch(() => {});
    process.exit(0);
  };

  let daemon: Daemon;
  try {
    daemon = await bindFirstFree(ports, log, (port) =>
      startDaemon({
        port,
        bridge,
        log,
        audit,
        context: {
          keys,
          doRun: (params, signal) =>
            handleDo(bridge, params, {
              runs,
              credentialsDir: config.dir,
              signal,
              audit,
              ...(trace ? { trace } : {}),
            }),
        },
        onShutdown: () => void shutdown("/shutdown", () => daemon.close()),
      }),
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(
      `reins: failed to start (tried port${ports.length > 1 ? "s" : ""} ${ports.join(", ")}): ${msg}. Is another reins daemon running? (\`reins status\`)`,
    );
    process.exit(1);
  }
  const rival = await lowerPortRival(ports, daemon.port);
  if (rival !== undefined) {
    log(`reins: another daemon already runs on port ${rival} — exiting (it wins)`);
    await daemon.close();
    process.exit(0);
  }
  recordPort(config.dir, daemon.port);
  process.on("SIGINT", () => void shutdown("SIGINT", () => daemon.close()));
  process.on("SIGTERM", () => void shutdown("SIGTERM", () => daemon.close()));
}
