import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AuditRecord } from "./audit.js";
import { auditFilePath, createAuditor, pruneAuditLogs, redactParams } from "./audit.js";

const dirs: string[] = [];
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), "reins-audit-"));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function record(over: Partial<AuditRecord> = {}): AuditRecord {
  return {
    ts: "2026-07-11T10:00:00.000Z",
    method: "click",
    params: { selector: "#go" },
    ok: true,
    ms: 42,
    ...over,
  };
}

describe("redactParams", () => {
  it.each([
    [
      "type",
      { text: "hunter2secret", selector: "#pw" },
      { text: "[redacted 13 chars]", selector: "#pw" },
    ],
    ["fill", { value: "hunter2", ref: "e3" }, { value: "[redacted 7 chars]", ref: "e3" }],
    ["select_option", { value: "US", ref: "e3" }, { value: "[redacted 2 chars]", ref: "e3" }],
    [
      "eval_js",
      { expression: "document.cookie", awaitPromise: false },
      { expression: "[redacted 15 chars]", awaitPromise: false },
    ],
    ["press_key", { key: "Meta+A" }, { key: "Meta+A" }],
    ["navigate", { to: "https://x.com/a" }, { to: "https://x.com/a" }],
    [
      "handle_dialog",
      { accept: true, promptText: "hunter2" },
      { accept: true, promptText: "[redacted 7 chars]" },
    ],
  ])("%s", (method, input, expected) => {
    expect(redactParams(method, input)).toEqual(expected);
  });

  it("keeps only basenames for upload files", () => {
    expect(redactParams("upload", { files: ["/Users/me/secret-dir/tax.pdf"], ref: "e1" })).toEqual({
      files: ["tax.pdf"],
      ref: "e1",
    });
  });

  it("redacts cdp nested params wholesale, keeps the method name", () => {
    expect(redactParams("cdp", { method: "Input.insertText", params: { text: "s3cret" } })).toEqual(
      { method: "Input.insertText", params: "[redacted]" },
    );
  });

  it("does not mutate its input", () => {
    const input = { text: "abc" };
    redactParams("type", input);
    expect(input.text).toBe("abc");
  });
});

describe("createAuditor", () => {
  it("appends one JSON line per record to the dated file", () => {
    const dir = tempDir();
    const now = () => new Date("2026-07-11T10:00:00Z");
    const audit = createAuditor(dir, { now });
    audit(record());
    audit(record({ method: "read_text" }));
    const lines = readFileSync(auditFilePath(dir, now()), "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0] as string).method).toBe("click");
    expect(JSON.parse(lines[1] as string).method).toBe("read_text");
  });

  it("is best-effort: write failure warns once, never throws", () => {
    const dir = tempDir();
    chmodSync(dir, 0o444); // unwritable
    const warnings: string[] = [];
    const audit = createAuditor(dir, {
      log: (m) => warnings.push(m),
      now: () => new Date("2026-07-11T10:00:00Z"),
    });
    expect(() => {
      audit(record());
      audit(record());
    }).not.toThrow();
    chmodSync(dir, 0o755); // so afterEach can clean up
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("audit write failed");
  });

  it("creates a missing nested directory before writing", () => {
    const dir = join(tempDir(), "nested", "logs");
    const now = () => new Date("2026-07-11T10:00:00Z");
    const audit = createAuditor(dir, { now });
    audit(record());
    const path = auditFilePath(dir, now());
    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path, "utf8").trim().split("\n")).toHaveLength(1);
  });
});

describe("pruneAuditLogs", () => {
  it("deletes audit files older than keepDays by filename date, nothing else", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "audit-2026-06-01.jsonl"), "");
    writeFileSync(join(dir, "audit-2026-07-10.jsonl"), "");
    writeFileSync(join(dir, "daemon-2026-06-01.log"), "");
    const deleted = pruneAuditLogs(dir, new Date("2026-07-11T00:00:00Z"), 30);
    expect(deleted).toEqual(["audit-2026-06-01.jsonl"]);
    const left = readdirSync(dir).sort();
    expect(left).toEqual(["audit-2026-07-10.jsonl", "daemon-2026-06-01.log"]);
  });

  it("survives a missing directory", () => {
    expect(pruneAuditLogs(join(tempDir(), "nope"), new Date())).toEqual([]);
  });
});
