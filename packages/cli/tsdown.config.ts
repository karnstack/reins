import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/cli.ts"],
  format: ["esm"],
  dts: false,
  clean: true,
  // Emit .js/.d.ts (not .mjs/.d.mts) so the bin paths (dist/server.js,
  // dist/cli.js) resolve. Safe because the package is "type":"module".
  fixedExtension: false,
  // @reins/protocol is a private workspace package — bundle it into dist so
  // the published reins-mcp package has no unresolvable dependency.
  noExternal: ["@reins/protocol"],
});
