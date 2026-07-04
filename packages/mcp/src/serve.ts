import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadAllowedOrigins } from "./allowlist.js";
import { BridgeHost } from "./bridge.js";
import { candidatePorts, loadOrCreateConfig, recordPort } from "./config.js";
import { createServer } from "./create-server.js";
import { type Daemon, startDaemon } from "./daemon.js";
import { createLogger, type Log } from "./log.js";

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

/** `reins serve` (HTTP daemon) / `reins serve --stdio` (per-client stdio). */
export async function runServe(opts: { stdio: boolean }): Promise<void> {
  const log = createLogger();
  const config = loadOrCreateConfig();
  const bridge = new BridgeHost({ allowedOrigins: loadAllowedOrigins(config.dir), log });
  const ports = candidatePorts(config);

  let shuttingDown = false;
  const shutdown = async (reason: string, cleanup: () => Promise<void>) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`reins: shutting down (${reason})`);
    await cleanup().catch(() => {});
    process.exit(0);
  };

  if (!opts.stdio) {
    let daemon: Daemon;
    try {
      daemon = await bindFirstFree(ports, log, (port) => startDaemon({ port, bridge, log }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log(
        `reins: failed to start (tried port${ports.length > 1 ? "s" : ""} ${ports.join(", ")}): ${msg}. Is another reins daemon running? (\`reins status\`)`,
      );
      process.exit(1);
    }
    recordPort(config.dir, daemon.port);
    process.on("SIGINT", () => void shutdown("SIGINT", () => daemon.close()));
    process.on("SIGTERM", () => void shutdown("SIGTERM", () => daemon.close()));
    return;
  }

  // stdio mode: bridge owns a port; the server lives and dies with the client.
  try {
    const bound = await bindFirstFree(ports, log, async (port) => {
      await bridge.listen(port);
      return port;
    });
    recordPort(config.dir, bound);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(
      `reins: failed to start the bridge (tried port${ports.length > 1 ? "s" : ""} ${ports.join(", ")}): ${msg}.`,
    );
    process.exit(1);
  }
  const server = createServer(bridge);
  const transport = new StdioServerTransport();
  const cleanup = async () => {
    await bridge.stop().catch(() => {});
    await server.close().catch(() => {});
  };
  // Without these the WebSocket server keeps the event loop alive after the
  // MCP client goes away, leaving an orphaned process squatting on the port.
  server.server.onclose = () => void shutdown("client closed the session", cleanup);
  process.stdin.on("end", () => void shutdown("stdin closed", cleanup));
  process.stdin.on("close", () => void shutdown("stdin closed", cleanup));
  process.on("SIGINT", () => void shutdown("SIGINT", cleanup));
  process.on("SIGTERM", () => void shutdown("SIGTERM", cleanup));
  await server.connect(transport);
  log("reins: MCP server ready (stdio)");
}
