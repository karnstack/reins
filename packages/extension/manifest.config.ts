import { defineManifest } from "@crxjs/vite-plugin";
import pkg from "./package.json";

// Permissions are deliberately minimal for Chrome Web Store review:
// - debugger:  run CDP commands (click/type/screenshot/eval/monitor) on tabs
// - tabs:      list tabs with title/url for list_tabs
// - storage:   persist the pairing (local) and connection status (session)
// - offscreen: host the persistent WebSocket to the local MCP server
// No host_permissions: all page access goes through chrome.debugger, and the
// extension injects no content scripts and fetches no remote resources.
export default defineManifest({
  manifest_version: 3,
  name: "reins",
  version: pkg.version,
  description: "Drive your real, logged-in browser from an MCP client.",
  permissions: ["debugger", "tabs", "storage", "offscreen"],
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
