import { chmodSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { KeyProvider, KeyStatus } from "@reins/protocol";

type Credentials = Partial<Record<KeyProvider, string>>;

/** One file for every connected browser; only the daemon reads it. */
export function credentialsPath(dir: string): string {
  return join(dir, "credentials.json");
}

function load(dir: string): Credentials {
  try {
    const v = JSON.parse(readFileSync(credentialsPath(dir), "utf8")) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Credentials) : {};
  } catch {
    return {};
  }
}

/** Write via temp file + rename so a crash never leaves a half-written key. */
function save(dir: string, creds: Credentials): void {
  const path = credentialsPath(dir);
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(creds, null, 2)}\n`, { mode: 0o600 });
  chmodSync(tmp, 0o600); // the create mode is masked by umask
  renameSync(tmp, path);
}

export function readKey(dir: string, provider: KeyProvider = "typesafe"): string | undefined {
  const key = load(dir)[provider];
  return typeof key === "string" && key !== "" ? key : undefined;
}

export function writeKey(dir: string, key: string, provider: KeyProvider = "typesafe"): void {
  save(dir, { ...load(dir), [provider]: key });
}

export function clearKey(dir: string, provider: KeyProvider = "typesafe"): void {
  const creds = load(dir);
  delete creds[provider];
  if (Object.keys(creds).length > 0) {
    save(dir, creds);
    return;
  }
  try {
    unlinkSync(credentialsPath(dir));
  } catch {
    // already gone
  }
}

export function keyStatus(dir: string, provider: KeyProvider = "typesafe"): KeyStatus {
  const key = readKey(dir, provider);
  return key ? { provider, set: true, last4: key.slice(-4) } : { provider, set: false };
}
