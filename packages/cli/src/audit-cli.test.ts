import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runAudit } from "./audit-cli.js";

const dirs: string[] = [];
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), "reins-audit-cli-"));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const NOW = () => new Date("2026-07-11T12:00:00Z");

function line(over: Record<string, unknown> = {}): string {
  return `${JSON.stringify({
    ts: "2026-07-11T10:15:02.113Z",
    method: "click",
    browserId: "b1",
    browser: "Chromium",
    tabId: 412,
    host: "app.example.com",
    tier: "full",
    params: { selector: "#go" },
    ok: true,
    ms: 184,
    ...over,
  })}\n`;
}

describe("runAudit", () => {
  it("renders today's records as a table", () => {
    const dir = tempDir();
    writeFileSync(
      join(dir, "audit-2026-07-11.jsonl"),
      line() + line({ method: "read_text", ms: 20 }),
    );
    const view = runAudit([], { dir, now: NOW });
    expect(view.out).toContain("10:15:02");
    expect(view.out).toContain("click");
    expect(view.out).toContain("app.example.com");
    expect(view.out).toContain("412");
    expect(view.out).toContain("ok");
    expect(view.warnings).toEqual([]);
  });

  it("marks policy denials as DENIED", () => {
    const dir = tempDir();
    writeFileSync(
      join(dir, "audit-2026-07-11.jsonl"),
      line({ ok: false, denied: true, error: "policy_denied: blocked", host: "bank.com" }),
    );
    const view = runAudit([], { dir, now: NOW });
    expect(view.out).toContain("DENIED");
    expect(view.out).toContain("bank.com");
  });

  it("--denied filters to denials only", () => {
    const dir = tempDir();
    writeFileSync(
      join(dir, "audit-2026-07-11.jsonl"),
      line() + line({ ok: false, denied: true, error: "policy_denied: blocked" }),
    );
    const view = runAudit(["--denied"], { dir, now: NOW });
    expect(view.out.match(/DENIED/g)).toHaveLength(1);
    expect(view.out).not.toMatch(/\bok\b/);
  });

  it("--last N crosses day files, newest last", () => {
    const dir = tempDir();
    writeFileSync(
      join(dir, "audit-2026-07-10.jsonl"),
      line({ method: "older" }) + line({ method: "old" }),
    );
    writeFileSync(join(dir, "audit-2026-07-11.jsonl"), line({ method: "newest" }));
    const view = runAudit(["--last", "2"], { dir, now: NOW });
    expect(view.out).not.toContain("older");
    const oldIdx = view.out.indexOf("old");
    const newIdx = view.out.indexOf("newest");
    expect(oldIdx).toBeGreaterThan(-1);
    expect(newIdx).toBeGreaterThan(oldIdx);
  });

  it("--json emits raw JSONL", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "audit-2026-07-11.jsonl"), line());
    const view = runAudit(["--json"], { dir, now: NOW });
    expect(JSON.parse(view.out).method).toBe("click");
  });

  it("renders — for missing host/tab and skips corrupt lines with a warning", () => {
    const dir = tempDir();
    writeFileSync(
      join(dir, "audit-2026-07-11.jsonl"),
      `not json\n5\n{}\n${line({ host: undefined, tabId: undefined, browser: undefined })}`,
    );
    const view = runAudit([], { dir, now: NOW });
    expect(view.out).toContain("—");
    expect(view.warnings).toEqual(["skipped 3 corrupt audit lines"]);
  });

  it("says so when there is nothing to show", () => {
    const view = runAudit([], { dir: tempDir(), now: NOW });
    expect(view.out).toContain("no audit records");
  });
});
