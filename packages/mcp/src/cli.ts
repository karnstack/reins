#!/usr/bin/env node
import { doctorReport, pairText } from "./cli-commands.js";
import { loadOrCreateConfig } from "./config.js";

const [command] = process.argv.slice(2);
const cfg = loadOrCreateConfig();

switch (command) {
  case "pair":
    console.log(pairText(cfg));
    break;
  case "doctor": {
    const report = doctorReport(cfg);
    for (const c of report.checks) {
      console.log(`${c.ok ? "✓" : "✗"} ${c.name}: ${c.detail}`);
    }
    console.log(report.ok ? "\nAll checks passed." : "\nSome checks failed.");
    process.exitCode = report.ok ? 0 : 1;
    break;
  }
  case "status":
    console.log(`config: ${cfg.dir}\nport: ${cfg.port}\nrun \`reins pair\` to connect a browser`);
    break;
  default:
    console.log("reins — usage: reins <pair|status|doctor>");
}
