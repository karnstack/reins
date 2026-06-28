import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/server.ts", "src/cli.ts", "src/create-server.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  // Emit .js/.d.ts (not .mjs/.d.mts) so the bin paths (dist/server.js,
  // dist/cli.js) resolve. Safe because the package is "type":"module".
  fixedExtension: false,
});
