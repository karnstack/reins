import { crx } from "@crxjs/vite-plugin";
import { defineConfig } from "vite";
import manifest from "./manifest.config.js";

export default defineConfig({
  plugins: [crx({ manifest })],
  server: { port: 5733, strictPort: true },
});
