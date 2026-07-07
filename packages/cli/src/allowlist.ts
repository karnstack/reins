import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SIDELOAD_EXTENSION_ID } from "./sideload.js";

/** Chrome Web Store id(s) of the published reins extension.
 *  https://chromewebstore.google.com/detail/reins/hnjcfgochepemjndccfblpmfmlblkofo */
export const PUBLISHED_EXTENSION_IDS: readonly string[] = ["hnjcfgochepemjndccfblpmfmlblkofo"];

/** Ids trusted without an allow-file entry: the store build(s) plus the
 *  key-pinned sideload build (`reins extension` — docs/SIDELOAD.md). */
const BUILTIN_IDS: readonly string[] = [...PUBLISHED_EXTENSION_IDS, SIDELOAD_EXTENSION_ID];

const ID_RE = /^[a-p]{32}$/;

function filePath(dir: string): string {
  return join(dir, "allowed-extensions");
}

/** All WS origins the bridge accepts: built-ins + ~/.reins/allowed-extensions. */
export function loadAllowedOrigins(dir: string): Set<string> {
  const ids = new Set(BUILTIN_IDS);
  try {
    for (const line of readFileSync(filePath(dir), "utf8").split("\n")) {
      const id = line.trim();
      if (ID_RE.test(id)) ids.add(id);
    }
  } catch {
    // no file — built-ins only
  }
  return new Set([...ids].map((id) => `chrome-extension://${id}`));
}

/** Add a dev/unpacked extension id (validated, idempotent). */
export function allowExtension(dir: string, id: string): void {
  if (!ID_RE.test(id)) throw new Error(`invalid extension id: ${id}`);
  mkdirSync(dir, { recursive: true });
  if (loadAllowedOrigins(dir).has(`chrome-extension://${id}`)) return;
  appendFileSync(filePath(dir), `${id}\n`);
}
