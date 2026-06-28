import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface ReinsConfig {
  dir: string;
  port: number;
  token: string;
}

const DEFAULT_PORT = 8765;

function resolvePort(explicit?: number): number {
  if (typeof explicit === "number") return explicit;
  const env = process.env.REINS_PORT;
  if (env && Number.isInteger(Number(env))) return Number(env);
  return DEFAULT_PORT;
}

/** Load the reins config from ~/.reins, creating the dir and token if absent. */
export function loadOrCreateConfig(opts: { home?: string; port?: number } = {}): ReinsConfig {
  const dir = join(opts.home ?? homedir(), ".reins");
  mkdirSync(dir, { recursive: true });

  const tokenPath = join(dir, "token");
  let token: string;
  try {
    token = readFileSync(tokenPath, "utf8").trim();
    if (!token) throw new Error("empty token");
  } catch {
    token = randomBytes(32).toString("base64url");
    writeFileSync(tokenPath, token, { mode: 0o600 });
  }

  const port = resolvePort(opts.port);
  writeFileSync(join(dir, "port"), String(port), { mode: 0o600 });

  return { dir, port, token };
}
