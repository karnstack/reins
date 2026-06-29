import { defineManifest } from "@crxjs/vite-plugin";

export default defineManifest({
  manifest_version: 3,
  name: "reins",
  version: "0.0.0",
  description: "Drive your real, logged-in browser from an MCP client.",
  permissions: ["debugger", "tabs", "storage", "offscreen", "alarms"],
  host_permissions: ["<all_urls>"],
  icons: {
    16: "icons/icon-16.png",
    32: "icons/icon-32.png",
    48: "icons/icon-48.png",
    128: "icons/icon-128.png",
  },
  background: { service_worker: "src/background.ts", type: "module" },
  action: {
    default_popup: "src/popup.html",
    default_icon: {
      16: "icons/icon-16.png",
      32: "icons/icon-32.png",
      48: "icons/icon-48.png",
      128: "icons/icon-128.png",
    },
  },
});
