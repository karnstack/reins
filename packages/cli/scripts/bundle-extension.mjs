// Copy ../extension/dist into ./extension with the sideload "key" injected,
// so the npm package can install the extension without the Chrome Web Store
// (`reins extension` — see docs/SIDELOAD.md). The store zip never gets the
// key; this touches only the CLI-side copy.
// Run: automatically after tsdown in this package's build/prepack scripts.
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "..", "extension", "dist");
const target = join(root, "extension");

if (!existsSync(join(source, "manifest.json"))) {
  console.error("packages/extension/dist/manifest.json missing — build @reins/extension first");
  process.exit(1);
}

rmSync(target, { recursive: true, force: true });
cpSync(source, target, { recursive: true });

const { key } = JSON.parse(readFileSync(join(root, "sideload-key.json"), "utf8"));
const manifestPath = join(target, "manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
manifest.key = key;
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`bundled extension → ${target} (sideload id pinned)`);
