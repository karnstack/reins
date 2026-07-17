import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  // Never clean: in `pnpm dev`, tsdown --watch would otherwise wipe dist/ on
  // startup while the extension/cli builds resolve @reins/protocol from it in
  // parallel, racing to "failed to resolve import". The single fixed entry
  // (src/index.ts → index.js/index.d.ts) overwrites in place, so no orphans.
  clean: false,
  // Emit .js/.d.ts (not .mjs/.d.mts) so the package's exports map and the
  // mcp package's bin paths resolve. Valid because every package is "type":"module".
  fixedExtension: false,
});
