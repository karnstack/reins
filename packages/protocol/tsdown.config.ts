import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  // Emit .js/.d.ts (not .mjs/.d.mts) so the package's exports map and the
  // mcp package's bin paths resolve. Valid because every package is "type":"module".
  fixedExtension: false,
});
