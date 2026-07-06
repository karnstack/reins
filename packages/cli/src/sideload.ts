import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import sideloadKey from "../sideload-key.json" with { type: "json" };

/** Public key pinned into the bundled build's manifest (`key` field) and the
 *  extension id Chrome derives from it. Committed in sideload-key.json so the
 *  bundle script and this module can't drift apart. */
export const SIDELOAD_PUBLIC_KEY: string = sideloadKey.key;
export const SIDELOAD_EXTENSION_ID: string = sideloadKey.id;

/** The extension build shipped inside the npm package, created by
 *  scripts/bundle-extension.mjs. Resolves relative to this module so it works
 *  from src/ (tests) and dist/ (published package) alike. */
export function bundledExtensionDir(): string {
  return fileURLToPath(new URL("../extension/", import.meta.url));
}

/** Stage the bundled extension at `target` (fixed path — Chrome's
 *  load-unpacked registration points there, so it must never move). Delete +
 *  copy so hashed chunks from previous versions don't accumulate. */
export function extractExtension(source: string, target: string): void {
  if (!existsSync(join(source, "manifest.json"))) {
    throw new Error(
      "no bundled extension in this install — in a source checkout, follow docs/RUNNING.md (load packages/extension/dist unpacked)",
    );
  }
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  cpSync(source, target, { recursive: true });
}

/** Steps printed after extraction. The sideload id is built into the daemon
 *  allowlist, so there is no `reins allow` step. */
export function sideloadInstructions(target: string): string {
  return [
    `extension staged at ${target}`,
    "",
    "Install (no Chrome Web Store needed):",
    "  1. open chrome://extensions (or dia://extensions etc.)",
    "  2. enable Developer mode (top right)",
    `  3. Load unpacked → select ${target}`,
    "  4. `reins status` — the browser connects on its own",
    "",
    "Already loaded from a previous version? Click ⟳ Reload on the reins",
    "card in chrome://extensions instead of Load unpacked.",
    "Sideloaded builds don't auto-update: re-run `reins extension` after",
    "upgrading the CLI, then Reload.",
  ].join("\n");
}
