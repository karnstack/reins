import { appendFileSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { basename, join } from "node:path";
import type { Tier } from "@reins/protocol";

/** One line of the per-action audit trail (spec: 2026-07-11-audit-log-design). */
export interface AuditRecord {
  ts: string;
  method: string;
  browserId?: string;
  browser?: string;
  tabId?: number;
  host?: string;
  tier?: Tier;
  params: Record<string, unknown>;
  ok: boolean;
  denied?: boolean;
  error?: string;
  ms: number;
}

export type AuditHook = (record: AuditRecord) => void;

/** Param keys whose string values are typed/filled/evaluated content. */
const VALUE_KEYS = new Set(["text", "value", "expression", "promptText"]);

/**
 * Strip secrets from params before they reach disk. Fixed field-name table,
 * not heuristics — extend VALUE_KEYS (plus a test row) when a new
 * value-bearing param appears.
 */
export function redactParams(
  method: string,
  params: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    if (VALUE_KEYS.has(key) && typeof value === "string") {
      out[key] = `[redacted ${value.length} chars]`;
    } else if (method === "upload" && key === "files" && Array.isArray(value)) {
      out[key] = value.map((f) => basename(String(f)));
    } else if (method === "cdp" && key === "params" && value !== undefined) {
      // Arbitrary CDP payloads can carry anything (Input.insertText, …).
      out[key] = "[redacted]";
    } else {
      out[key] = value;
    }
  }
  return out;
}

export const AUDIT_FILE_RE = /^audit-(\d{4}-\d{2}-\d{2})\.jsonl$/;

/** Audit file for a given day, e.g. <dir>/audit-2026-07-11.jsonl. */
export function auditFilePath(dir: string, now: Date): string {
  return join(dir, `audit-${now.toISOString().slice(0, 10)}.jsonl`);
}

/**
 * Appender for the audit trail. Best-effort like createLogger: a full disk
 * or bad permissions must never fail the user's command — warn once and
 * keep going (the trail can have gaps under disk pressure; SECURITY.md
 * documents the trade-off).
 */
export function createAuditor(
  dir: string,
  opts: { log?: (msg: string) => void; now?: () => Date } = {},
): AuditHook {
  const now = opts.now ?? (() => new Date());
  let warned = false;
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    // fall through — the append below will warn
  }
  return (record) => {
    try {
      appendFileSync(auditFilePath(dir, now()), `${JSON.stringify(record)}\n`);
    } catch (err) {
      if (warned) return;
      warned = true;
      const msg = err instanceof Error ? err.message : String(err);
      opts.log?.(`reins: audit write failed (${msg}) — the trail will have gaps`);
    }
  };
}

/** Delete audit files whose filename date is older than keepDays. Returns
 *  the deleted names. Filename-based, not mtime — deterministic. */
export function pruneAuditLogs(dir: string, now: Date, keepDays = 30): string[] {
  const cutoff = new Date(now.getTime() - keepDays * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const deleted: string[] = [];
  for (const name of names) {
    const m = AUDIT_FILE_RE.exec(name);
    if (!m || (m[1] as string) >= cutoff) continue;
    try {
      unlinkSync(join(dir, name));
      deleted.push(name);
    } catch {
      // best-effort
    }
  }
  return deleted;
}
