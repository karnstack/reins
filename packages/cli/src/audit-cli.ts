import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs, UsageError } from "./args.js";
import { AUDIT_FILE_RE, type AuditRecord } from "./audit.js";

const USAGE = "usage: reins audit [--last <n>] [--denied] [--json]";

export interface AuditView {
  out: string;
  warnings: string[];
}

interface Loaded {
  records: AuditRecord[];
  skipped: number;
}

/** Guard against JSON-parseable but shape-invalid lines (e.g. `5`, `{}`) that
 *  would otherwise crash the table renderer on `r.ts.slice`. */
function isAuditRecord(v: unknown): v is AuditRecord {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return typeof r.ts === "string" && typeof r.method === "string";
}

function loadFiles(dir: string, files: string[]): Loaded {
  const records: AuditRecord[] = [];
  let skipped = 0;
  for (const name of files) {
    let text: string;
    try {
      text = readFileSync(join(dir, name), "utf8");
    } catch {
      continue;
    }
    for (const line of text.split("\n")) {
      if (line.trim() === "") continue;
      try {
        const parsed: unknown = JSON.parse(line);
        if (!isAuditRecord(parsed)) {
          skipped += 1;
          continue;
        }
        records.push(parsed);
      } catch {
        skipped += 1;
      }
    }
  }
  return { records, skipped };
}

function auditFiles(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((n) => AUDIT_FILE_RE.test(n))
      .sort(); // filename dates sort chronologically
  } catch {
    return [];
  }
}

function outcome(r: AuditRecord): string {
  if (r.denied === true) return "DENIED";
  return r.ok ? "ok" : "error";
}

function table(records: AuditRecord[]): string {
  const rows = records.map((r) => [
    r.ts.slice(11, 19),
    r.method,
    r.browser ?? "—",
    r.host ?? "—",
    r.tabId !== undefined ? String(r.tabId) : "—",
    outcome(r),
    String(r.ms),
  ]);
  const header = ["TIME", "METHOD", "BROWSER", "HOST", "TAB", "OUTCOME", "MS"];
  const widths = header.map((h, i) =>
    Math.max(h.length, ...rows.map((row) => (row[i] as string).length)),
  );
  const render = (row: string[]) =>
    row
      .map((cell, i) => cell.padEnd(widths[i] as number))
      .join("  ")
      .trimEnd();
  return [render(header), ...rows.map(render)].join("\n");
}

/** `reins audit` — render the per-action trail from ~/.reins/logs, no daemon needed. */
export function runAudit(argv: string[], deps: { dir: string; now: () => Date }): AuditView {
  const a = parseArgs(argv, { booleans: ["denied", "json"] });
  if (a.positional.length > 0) throw new UsageError(USAGE);
  let last: number | undefined;
  if (a.flags.last !== undefined) {
    last = Number.parseInt(String(a.flags.last), 10);
    if (Number.isNaN(last) || last <= 0)
      throw new UsageError(`--last expects a positive integer\n${USAGE}`);
  }

  const all = auditFiles(deps.dir);
  const today = `audit-${deps.now().toISOString().slice(0, 10)}.jsonl`;
  const files = last !== undefined ? all : all.filter((n) => n === today);
  const { records, skipped } = loadFiles(deps.dir, files);

  let selected = records;
  if (a.flags.denied === true) selected = selected.filter((r) => r.denied === true);
  if (last !== undefined) selected = selected.slice(-last);

  const warnings =
    skipped > 0 ? [`skipped ${skipped} corrupt audit line${skipped === 1 ? "" : "s"}`] : [];

  if (selected.length === 0) {
    return {
      out: `no audit records${last !== undefined ? "" : " for today"} in ${deps.dir} (the daemon writes one line per action).`,
      warnings,
    };
  }
  if (a.flags.json === true) {
    return { out: selected.map((r) => JSON.stringify(r)).join("\n"), warnings };
  }
  return { out: table(selected), warnings };
}
