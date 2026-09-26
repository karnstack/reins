import type { DoResult } from "./types.js";

const MANUAL = "switch to manual (reins snapshot → click/type)";

/** POSIX single-quoted string: nothing inside expands, so a page-controlled label is inert. */
export function shellQuote(s: string): string {
  return `'${s.replaceAll("'", "'\\''")}'`;
}

/** Turns a field label into a `--fill` key: "Where to?" → "where_to". */
export function fillName(label: string): string {
  const name = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 24);
  return name || "value";
}

/** The exact command the agent should run next — every stop carries one (errors carry none). */
export function nextCommand(
  r: DoResult,
  p: { goal: string; tabId?: number; browserId?: string },
): string | undefined {
  const route = `${p.tabId !== undefined ? ` --tab ${p.tabId}` : ""}${p.browserId !== undefined ? ` --browser ${p.browserId}` : ""}`;
  switch (r.status) {
    case "done":
      return "reins snapshot   # verify before trusting DONE";
    case "risky_action":
      return `reins do --continue --confirm ${shellQuote(r.pending?.label ?? "")}${route}`;
    case "needs_text":
      return `reins do --continue --fill ${fillName(r.pending?.label ?? "")}="…"${route}`;
    case "dialog":
      return `reins dialog --accept (or --dismiss), then reins do --continue${route}`;
    case "left_site":
      return `reins do ${shellQuote(p.goal)}${route}   # from this page, if the new site is expected`;
    case "interrupted":
    case "budget":
      return `reins do --continue${route}`;
    case "blocked":
    case "stuck":
      return MANUAL;
    case "error":
      return undefined;
  }
}

const sec = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

/** Human output for a `reins do` run: header, steps, where we are, and what to run next. */
export function formatDoResult(r: DoResult): string {
  const lines: string[] = [
    r.status === "done"
      ? `done in ${sec(r.elapsedMs)} · ${r.steps.length} steps · ${r.jevCalls} jev calls`
      : `${r.status}: ${r.reason ?? ""}`.trimEnd(),
  ];
  for (const s of r.steps) {
    lines.push(
      `${String(s.n).padStart(3)} ${s.op.padEnd(6)} ${JSON.stringify(s.label)}${s.fill ? ` ← ${s.fill}` : ""}`,
    );
  }
  if (r.status === "done") lines.push(`now: ${r.url} — ${JSON.stringify(r.title)}`);
  else if (r.status !== "error" || r.steps.length > 0) {
    lines.push(
      `stopped at step ${r.step}/${r.maxSteps} · page changed ${r.pageChanges}× · ${sec(r.elapsedMs)}`,
    );
  }
  if (r.next) lines.push(`next: ${r.next}`);
  return lines.join("\n");
}
