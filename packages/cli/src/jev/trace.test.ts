import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { JevBody } from "./client.js";
import { fileTraceSink, type JevTraceLine, summarizeAnswers, traceAsk } from "./trace.js";

const body: JevBody = {
  state: { page: { text: "SECRET PAGE TEXT" }, supplied_values: { query: "SECRET VALUE" } },
  questions: {
    operation: { type: "choice", criteria: { CLICK: "c", DONE: "d" }, instructions: "x" },
    click_target: { type: "choice", criteria: { "1": "a", "2": "b" }, instructions: "x" },
    fill_for_3: { type: "choice", criteria: { query: "q", NONE: "n" }, instructions: "x" },
  },
};

const answers = {
  operation: {
    choice: "CLICK",
    confidence: 0.91234,
    probabilities: { CLICK: 0.91234, DONE: 0.08766 },
  },
  click_target: { choice: "2", confidence: 0.7, probabilities: { "1": 0.3, "2": 0.7 } },
  fill_for_3: { choice: "query", confidence: 0.99, probabilities: { query: 0.99, NONE: 0.01 } },
};

describe("summarizeAnswers", () => {
  it("keeps the operation, each target head and the chosen fill names", () => {
    const s = summarizeAnswers(Object.keys(body.questions), answers);
    expect(s.operation?.choice).toBe("CLICK");
    expect(s.operation?.probabilities).toEqual({ CLICK: 0.9123, DONE: 0.0877 });
    expect(s.targets.click_target?.choice).toBe("2");
    expect(s.fills).toEqual({ fill_for_3: "query" });
  });

  it("skips heads with unusable answers", () => {
    const s = summarizeAnswers(["operation", "click_target"], { operation: "nope" });
    expect(s.operation).toBeUndefined();
    expect(s.targets).toEqual({});
    expect(s.checks).toBeUndefined();
  });

  it("keeps a yes/no answer's probability under checks", () => {
    const s = summarizeAnswers(["satisfied"], { satisfied: { type: "noul", noul: 0.34567 } });
    expect(s).toEqual({ targets: {}, fills: {}, checks: { satisfied: 0.3457 } });
  });
});

describe("traceAsk", () => {
  it("writes one line per answered call with the token delta, never the state", async () => {
    const lines: JevTraceLine[] = [];
    let tokens = 100;
    let t = 1_000;
    const ask = traceAsk(
      async () => {
        tokens += 250;
        t += 40;
        return answers;
      },
      (l) => lines.push(l),
      () => tokens,
      () => t,
    );
    await expect(ask(body)).resolves.toBe(answers);
    expect(lines).toHaveLength(1);
    const line = lines[0] as JevTraceLine;
    expect(line.t).toBe(new Date(1_000).toISOString());
    expect(line.ms).toBe(40);
    expect(line.questions).toEqual(["operation", "click_target", "fill_for_3"]);
    expect(line.inputTokens).toBe(250);
    expect(line.operation?.choice).toBe("CLICK");
    expect(line.error).toBeUndefined();
    expect(JSON.stringify(line)).not.toMatch(/SECRET/);
  });

  it("writes a line for a failed call and rethrows", async () => {
    const lines: JevTraceLine[] = [];
    const ask = traceAsk(
      async () => {
        throw new Error("boom");
      },
      (l) => lines.push(l),
    );
    await expect(ask(body)).rejects.toThrow("boom");
    expect(lines).toHaveLength(1);
    expect(lines[0]?.error).toBe("boom");
    expect(lines[0]?.operation).toBeUndefined();
  });
});

describe("fileTraceSink", () => {
  let dir: string;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("appends JSON lines", () => {
    dir = mkdtempSync(join(tmpdir(), "jev-trace-"));
    const file = join(dir, "trace.jsonl");
    const sink = fileTraceSink(file);
    const line: JevTraceLine = {
      t: "2026-01-01T00:00:00.000Z",
      ms: 1,
      questions: ["operation"],
      targets: {},
      fills: {},
      inputTokens: 5,
    };
    sink(line);
    sink({ ...line, ms: 2 });
    const text = readFileSync(file, "utf8");
    const parsed = text
      .trimEnd()
      .split("\n")
      .map((l) => JSON.parse(l) as JevTraceLine);
    expect(parsed.map((l) => l.ms)).toEqual([1, 2]);
  });

  it("swallows write failures", () => {
    dir = mkdtempSync(join(tmpdir(), "jev-trace-"));
    const sink = fileTraceSink(join(dir, "missing", "dir", "trace.jsonl"));
    expect(() =>
      sink({ t: "", ms: 0, questions: [], targets: {}, fills: {}, inputTokens: 0 }),
    ).not.toThrow();
  });
});
