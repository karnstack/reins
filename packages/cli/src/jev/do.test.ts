import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditRecord } from "../audit.js";
import type { BridgePort } from "../bridge.js";
import { RpcBadRequest } from "../rpc.js";
import { writeKey } from "./credentials.js";
import { handleDo } from "./do.js";
import { RunStore } from "./runs.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "reins-do-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const OBS = {
  url: "https://x.com/",
  title: "X",
  text: "t",
  visible: true,
  actions: [
    { id: "b1", kind: "click", node: 1, role: "button", label: "Search" },
    { id: "wait", kind: "wait", label: "Wait for the page to update" },
  ],
};

function bridge(observe: unknown = OBS): BridgePort {
  return {
    paired: true,
    browsers: [{ id: "b1", browser: "Chrome", connectedAt: 0 }],
    request: vi.fn(),
    requestFull: vi.fn(async (method: string) =>
      method === "jev_observe"
        ? {
            result: observe,
            meta: { tabId: 5, host: "x.com", tier: "full" as const },
            browserId: "b1",
          }
        : {
            result: { ok: true },
            meta: { tabId: 5, host: "x.com", tier: "full" as const },
            browserId: "b1",
          },
    ),
  } as unknown as BridgePort;
}

type AskBody = { questions: Record<string, { criteria: Record<string, unknown> }> };

const doneAsk = () => async (body: AskBody) => {
  const ids = Object.keys(body.questions.operation?.criteria ?? {});
  return {
    operation: {
      choice: "DONE",
      confidence: 0.9,
      probabilities: Object.fromEntries(ids.map((id) => [id, id === "DONE" ? 1 : 0])),
    },
  };
};

/** Clicks the first target on the first ask, then says DONE. */
const clickThenDone = (onAsk?: (n: number) => void) => {
  let n = 0;
  return async (body: AskBody) => {
    onAsk?.(n);
    const op = n++ === 0 ? "CLICK" : "DONE";
    const ids = Object.keys(body.questions.operation?.criteria ?? {});
    const target = body.questions.click_target
      ? Object.keys(body.questions.click_target.criteria)
      : [];
    return {
      operation: {
        choice: op,
        confidence: 0.9,
        probabilities: Object.fromEntries(ids.map((id) => [id, id === op ? 1 : 0])),
      },
      ...(target.length > 0
        ? {
            click_target: {
              choice: target[0],
              confidence: 0.9,
              probabilities: Object.fromEntries(target.map((id, i) => [id, i === 0 ? 1 : 0])),
            },
          }
        : {}),
    };
  };
};

const params = {
  goal: "find it",
  fills: {},
  confirms: [],
  continue: false,
  maxSteps: 30,
  timeoutSec: 60,
};

describe("handleDo", () => {
  it.each([
    ["an uppercase fill name", { ...params, fills: { From: "Zurich" } }, /fills/],
    ["maxSteps 0", { ...params, maxSteps: 0 }, /maxSteps/],
    ["timeoutSec 1", { ...params, timeoutSec: 1 }, /timeoutSec/],
  ])("rejects %s as a bad request naming the field", async (_name, bad, field) => {
    const b = bridge();
    const promise = handleDo(b, bad, {
      runs: new RunStore(),
      credentialsDir: dir,
      signal: new AbortController().signal,
    });
    await expect(promise).rejects.toBeInstanceOf(RpcBadRequest);
    await expect(promise).rejects.toThrow(/^invalid reins do params: /);
    await expect(promise).rejects.toThrow(field);
    const message = await promise.catch((e: Error) => e.message);
    expect(message).not.toContain("\n");
    expect(b.requestFull).not.toHaveBeenCalled();
  });

  it("returns interrupted before its first observation when already aborted", async () => {
    writeKey(dir, "ts_live_abcd1234");
    const b = bridge();
    const ctrl = new AbortController();
    ctrl.abort(new Error("daemon restarting"));
    const r = await handleDo(b, params, {
      runs: new RunStore(),
      credentialsDir: dir,
      signal: ctrl.signal,
    });
    expect(r).toMatchObject({
      status: "interrupted",
      reason: "daemon restarting",
      steps: [],
      step: 0,
      maxSteps: 30,
    });
    expect(b.requestFull).not.toHaveBeenCalled();
  });

  it("pins the tab from the first observation and keeps it for every later call", async () => {
    writeKey(dir, "ts_live_abcd1234");
    const b = bridge();
    let n = 0;
    (b.requestFull as ReturnType<typeof vi.fn>).mockImplementation(async (method: string) => ({
      result: method === "jev_observe" ? OBS : { ok: true },
      // A later reply claiming another tab must not move the run.
      meta: { tabId: n++ === 0 ? 5 : 9, host: "x.com", tier: "full" },
      browserId: "b1",
    }));
    const runs = new RunStore();
    const r = await handleDo(b, params, {
      runs,
      credentialsDir: dir,
      signal: new AbortController().signal,
      createAsk: () => clickThenDone() as never,
    });
    expect(r.status).toBe("done");
    expect(runs.get("b1:5")).toBeDefined();
    expect(runs.get("b1:9")).toBeUndefined();
    const calls = (b.requestFull as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.length).toBeGreaterThan(1);
    for (const [, payload] of calls.slice(1)) expect(payload).toMatchObject({ tabId: 5 });
  });

  it("refuses without a key, pointing at both ways to add one", async () => {
    const r = await handleDo(bridge(), params, {
      runs: new RunStore(),
      credentialsDir: dir,
      signal: new AbortController().signal,
    });
    expect(r.status).toBe("error");
    expect(r.reason).toContain("reins key set typesafe");
    expect(r.reason).toContain("extension popup");
  });

  it("runs, stores the run, and prints the next command", async () => {
    writeKey(dir, "ts_live_abcd1234");
    const runs = new RunStore();
    const r = await handleDo(bridge(), params, {
      runs,
      credentialsDir: dir,
      signal: new AbortController().signal,
      createAsk: doneAsk as never,
    });
    expect(r).toMatchObject({
      status: "done",
      next: "reins snapshot   # verify before trusting DONE",
    });
    expect(runs.get("b1:5")?.goal).toBe("find it");
  });

  it("releases the tab lock after a run", async () => {
    writeKey(dir, "ts_live_abcd1234");
    const runs = new RunStore();
    await handleDo(bridge(), params, {
      runs,
      credentialsDir: dir,
      signal: new AbortController().signal,
      createAsk: doneAsk as never,
    });
    expect(runs.tryBegin("b1:5")).toBe(true);
  });

  it("--continue with nothing stored says so", async () => {
    writeKey(dir, "ts_live_abcd1234");
    const runs = new RunStore();
    const r = await handleDo(
      bridge(),
      { ...params, goal: undefined, continue: true },
      {
        runs,
        credentialsDir: dir,
        signal: new AbortController().signal,
        createAsk: doneAsk as never,
      },
    );
    expect(r.status).toBe("error");
    expect(r.reason).toContain("no run to continue on this tab");
    // The early return still released the lock.
    expect(runs.tryBegin("b1:5")).toBe(true);
  });

  it("--continue merges new fills/confirms into the stored run and routes next by the given tab", async () => {
    writeKey(dir, "ts_live_abcd1234");
    const runs = new RunStore();
    await handleDo(
      bridge(),
      { ...params, confirms: ["Buy"] },
      {
        runs,
        credentialsDir: dir,
        signal: new AbortController().signal,
        createAsk: doneAsk as never,
      },
    );
    const r = await handleDo(
      bridge(),
      {
        ...params,
        goal: undefined,
        continue: true,
        fills: { city: "Bern" },
        confirms: ["Pay"],
        tabId: 5,
      },
      {
        runs,
        credentialsDir: dir,
        signal: new AbortController().signal,
        createAsk: doneAsk as never,
      },
    );
    expect(r.status).toBe("done");
    expect(runs.get("b1:5")).toMatchObject({
      goal: "find it",
      fills: { city: "Bern" },
      confirms: ["Buy", "Pay"],
    });
  });

  it("requires a goal for a fresh run", async () => {
    writeKey(dir, "ts_live_abcd1234");
    const r = await handleDo(
      bridge(),
      { ...params, goal: undefined },
      { runs: new RunStore(), credentialsDir: dir, signal: new AbortController().signal },
    );
    expect(r.status).toBe("error");
    expect(r.reason).toContain("a goal is required");
  });

  it("refuses a second run on a busy tab", async () => {
    writeKey(dir, "ts_live_abcd1234");
    const runs = new RunStore();
    runs.tryBegin("b1:5");
    const r = await handleDo(bridge(), params, {
      runs,
      credentialsDir: dir,
      signal: new AbortController().signal,
    });
    expect(r.reason).toBe("a reins do run is already active on this tab");
    // The refusal must not release the other run's lock.
    expect(runs.tryBegin("b1:5")).toBe(false);
  });

  it("names an extension too old for reins do", async () => {
    writeKey(dir, "ts_live_abcd1234");
    const b = bridge();
    (b.requestFull as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      Object.assign(new Error("HANDLER_ERROR: unknown method: jev_observe"), {
        code: "HANDLER_ERROR",
      }),
    );
    const r = await handleDo(b, params, {
      runs: new RunStore(),
      credentialsDir: dir,
      signal: new AbortController().signal,
    });
    expect(r.status).toBe("error");
    expect(r.reason).toContain("too old for reins do");
  });

  it("audits every action with the typed text redacted", async () => {
    writeKey(dir, "ts_live_abcd1234");
    const records: AuditRecord[] = [];
    const obs = {
      ...OBS,
      actions: [
        { id: "f1", kind: "fill", node: 2, role: "textbox", label: "City", value: "" },
        OBS.actions[1],
      ],
    };
    let n = 0;
    const ask = async (body: AskBody) => {
      const out: Record<string, unknown> = {};
      for (const [name, q] of Object.entries(body.questions)) {
        const ids = Object.keys(q.criteria);
        const choice =
          name === "operation"
            ? n === 0
              ? "TYPE_TEXT"
              : "DONE"
            : name.startsWith("fill_for_")
              ? "city"
              : (ids[0] as string);
        out[name] = {
          choice,
          confidence: 0.9,
          probabilities: Object.fromEntries(ids.map((id) => [id, id === choice ? 1 : 0])),
        };
      }
      n += 1;
      return out;
    };
    await handleDo(
      bridge(obs),
      { ...params, fills: { city: "Zurich" } },
      {
        runs: new RunStore(),
        credentialsDir: dir,
        signal: new AbortController().signal,
        audit: (r) => records.push(r),
        createAsk: () => ask as never,
      },
    );
    const act = records.find((r) => r.method === "jev_act");
    expect(act).toMatchObject({
      method: "jev_act",
      ok: true,
      browserId: "b1",
      tabId: 5,
      host: "x.com",
      tier: "full",
      params: { op: "type", node: 2, label: "City", text: "[redacted 6 chars]" },
    });
    expect(records.filter((r) => r.method === "jev_observe")).toHaveLength(0);
    expect(JSON.stringify(records)).not.toContain("Zurich");
    expect(JSON.stringify(records)).not.toContain("abcd1234");
  });

  it("audits a failed action as ok: false and returns error without throwing", async () => {
    writeKey(dir, "ts_live_abcd1234");
    const records: AuditRecord[] = [];
    const b = bridge();
    const clickAsk = clickThenDone();
    (b.requestFull as ReturnType<typeof vi.fn>).mockImplementation(async (method: string) => {
      if (method === "jev_act") throw Object.assign(new Error("boom"), { browserId: "b1" });
      return { result: OBS, meta: { tabId: 5, host: "x.com", tier: "full" }, browserId: "b1" };
    });
    const runs = new RunStore();
    const r = await handleDo(b, params, {
      runs,
      credentialsDir: dir,
      signal: new AbortController().signal,
      audit: (rec) => records.push(rec),
      createAsk: () => clickAsk as never,
    });
    expect(r.status).toBe("error");
    expect(r.reason).toBe("boom");
    expect(records.find((rec) => rec.method === "jev_act")).toMatchObject({
      ok: false,
      error: "boom",
    });
    expect(runs.tryBegin("b1:5")).toBe(true);
  });

  it("reports interrupted with the abort reason and keeps the run for --continue", async () => {
    writeKey(dir, "ts_live_abcd1234");
    const ctrl = new AbortController();
    const runs = new RunStore();
    // The shutdown lands while Jev is answering: nothing more is acted on.
    const ask = clickThenDone(() => ctrl.abort(new Error("daemon restarting")));
    const r = await handleDo(bridge(), params, {
      runs,
      credentialsDir: dir,
      signal: ctrl.signal,
      createAsk: () => ask as never,
    });
    expect(r).toMatchObject({
      status: "interrupted",
      reason: "daemon restarting",
      next: "reins do --continue",
    });
    expect(runs.get("b1:5")?.goal).toBe("find it");
  });
});
