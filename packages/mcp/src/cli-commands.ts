import type { ReinsConfig } from "./config.js";

/** Human-readable pairing instructions for `reins pair`. */
export function pairText(cfg: ReinsConfig): string {
  return [
    "reins pairing",
    "",
    `  WebSocket URL : ws://127.0.0.1:${cfg.port}`,
    `  Token        : ${cfg.token}`,
    "",
    "Paste both into the reins extension popup to connect this browser.",
  ].join("\n");
}

export interface DoctorReport {
  checks: Array<{ name: string; ok: boolean; detail: string }>;
  ok: boolean;
}

/** Diagnostic checks for `reins doctor`. */
export function doctorReport(cfg: ReinsConfig): DoctorReport {
  const checks = [
    { name: "config-dir", ok: cfg.dir.length > 0, detail: cfg.dir },
    { name: "token", ok: cfg.token.length >= 43, detail: `${cfg.token.length} chars` },
    { name: "port", ok: Number.isInteger(cfg.port) && cfg.port > 0, detail: String(cfg.port) },
    { name: "node", ok: process.versions.node.length > 0, detail: `v${process.versions.node}` },
  ];
  return { checks, ok: checks.every((c) => c.ok) };
}
