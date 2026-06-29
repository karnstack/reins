// Render icons/icon.svg into the PNG sizes Chrome MV3 needs.
// Run: pnpm --filter @reins/extension gen:icons
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";

const here = dirname(fileURLToPath(import.meta.url));
const iconsDir = join(here, "..", "icons");
const svg = readFileSync(join(iconsDir, "icon.svg"), "utf8");

const sizes = [16, 32, 48, 128];
for (const size of sizes) {
  const resvg = new Resvg(svg, { fitTo: { mode: "width", value: size } });
  writeFileSync(join(iconsDir, `icon-${size}.png`), resvg.render().asPng());
  console.log(`wrote icons/icon-${size}.png`);
}
