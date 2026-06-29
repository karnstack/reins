import { crx } from "@crxjs/vite-plugin";
import { defineConfig } from "vite";
import manifest from "./manifest.config.js";

export default defineConfig({
  plugins: [crx({ manifest })],
  server: { port: 5733, strictPort: true },
  build: {
    rollupOptions: {
      // offscreen.html is loaded at runtime via chrome.offscreen.createDocument,
      // not referenced in the manifest, so @crxjs/vite-plugin would not bundle it
      // automatically. Listing it here as an explicit Rollup input ensures it lands
      // in dist/ and its <script type="module"> is processed by Vite.
      input: {
        offscreen: "src/offscreen.html",
      },
    },
  },
});
