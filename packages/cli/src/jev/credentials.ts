import { chmodSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { KeyProvider, KeyStatus } from "@reins/protocol";

type Credentials = Partial<Record<KeyProvider, string>>;

/** One file for every connected browser; only the daemon reads it. */
export function credentialsPath(dir: string): string {
  return join(dir, "credentials.json");
}

const isEnoent = (err: unknown): boolean =>
  (err as NodeJS.ErrnoException | undefined)?.code === "ENOENT";

/** The file as written by `save`. A missing file is no credentials; a file
 *  that can't be read or parsed is an error — never "not set", which would
 *  send the user to re-enter a key that a later fix would resurrect. The
 *  message names the file but never its contents. */
function load(dir: string): Credentials {
  const path = credentialsPath(dir);
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (err) {
    if (isEnoent(err)) return {};
    const code = (err as NodeJS.ErrnoException).code ?? "unreadable";
    throw new Error(`credentials file ${path} could not be read (${code}) — fix or delete it`);
  }
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    v = undefined;
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) {
    throw new Error(`credentials file ${path} is not valid JSON — fix or delete it`);
  }
  return v as Credentials;
}

/** Write via temp file + rename so a crash never leaves a half-written key. */
function save(dir: string, creds: Credentials): void {
  const path = credentialsPath(dir);
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(creds, null, 2)}\n`, { mode: 0o600 });
  try {
    chmodSync(tmp, 0o600); // the create mode is masked by umask
    renameSync(tmp, path);
  } catch (err) {
    // Don't leave the key lying in a temp file next to the one it never became.
    try {
      unlinkSync(tmp);
    } catch {
      // already gone
    }
    throw err;
  }
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
  } catch (err) {
    // Already gone is fine; a key that can't be removed is not.
    if (!isEnoent(err)) throw err;
  }
}

export function keyStatus(dir: string, provider: KeyProvider = "typesafe"): KeyStatus {
  const key = readKey(dir, provider);
  return key ? { provider, set: true, last4: key.slice(-4) } : { provider, set: false };
}
