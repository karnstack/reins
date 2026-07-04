// Package dist/ into a Chrome Web Store uploadable zip.
// Run: pnpm --filter @reins/extension zip   (builds first, then zips)
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
if (!existsSync(join(dist, "manifest.json"))) {
  console.error("dist/manifest.json missing — run `pnpm build` first");
  process.exit(1);
}

const { version } = createRequire(import.meta.url)(join(root, "package.json"));
const outDir = join(root, "release");
mkdirSync(outDir, { recursive: true });
const outFile = join(outDir, `reins-extension-v${version}.zip`);
rmSync(outFile, { force: true });

// `zip` is available on macOS and Linux (incl. GitHub Actions runners).
execFileSync("zip", ["-r", "-X", outFile, "."], { cwd: dist, stdio: "ignore" });
console.log(`wrote ${outFile}`);
