import { describe, expect, it, vi } from "vitest";
import { createJevAsk, JevError, validateChoice, validateKey } from "./client.js";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const OK = {
  model: "jev-1",
  usage: { input_tokens: 1, output_tokens: 1 },
  answers: {
    op: { type: "choice", choice: "a", confidence: 0.9, probabilities: { a: 0.9, b: 0.1 } },
  },
};
const BODY = {
  state: { page: "x" },
  questions: { op: { type: "choice" as const, criteria: { a: "A", b: "B" } } },
};
const NO_WAIT = { backoffInitialMs: 0, backoffMaxMs: 0 };

describe("createJevAsk", () => {
  it("posts to systemone with the key and returns the answers", async () => {
    const fetch = vi.fn(async () => json(200, OK));
    const ask = createJevAsk({ key: "ts_key_12345678", fetch });
    expect(await ask(BODY)).toEqual(OK.answers);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.typesafe.ai/v1/systemone");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer ts_key_12345678");
    expect(JSON.parse(String(init.body)).model).toBe("jev-latest");
  });

  it("retries a 429, then succeeds", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(json(429, { error: "slow down" }))
      .mockResolvedValueOnce(json(200, OK));
    const ask = createJevAsk({ key: "ts_key_12345678", fetch, retry: NO_WAIT });
    expect(await ask(BODY)).toEqual(OK.answers);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("names a rejected key", async () => {
    const ask = createJevAsk({ key: "ts_bad_12345678", fetch: async () => json(401, {}) });
    await expect(ask(BODY)).rejects.toMatchObject({ code: "key_rejected" });
    await expect(ask(BODY)).rejects.toThrow("TypeSafe rejected the API key");
  });

  it("reports other HTTP errors without retrying forever", async () => {
    const fetch = vi.fn(async () => json(500, {}));
    const ask = createJevAsk({ key: "ts_key_12345678", fetch, retry: NO_WAIT });
    await expect(ask(BODY)).rejects.toMatchObject({ code: "http" });
    expect(fetch).toHaveBeenCalledTimes(3); // 1 + SDK default 2 retries
  });

  it("reports a network failure", async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const ask = createJevAsk({
      key: "ts_key_12345678",
      fetch,
      retry: { ...NO_WAIT, apiConnectionError: false },
    });
    await expect(ask(BODY)).rejects.toMatchObject({ code: "network" });
  });
});

describe("validateChoice", () => {
  const ids = ["a", "b"];
  const good = { choice: "a", confidence: 0.8, probabilities: { a: 0.7, b: 0.3 } };

  it("accepts a well-formed answer", () => {
    expect(validateChoice(good, ids)).toEqual(good);
  });

  it.each([
    ["a choice that wasn't offered", { ...good, choice: "c" }],
    ["a missing probability", { ...good, probabilities: { a: 1 } }],
    ["an extra probability", { ...good, probabilities: { a: 0.5, b: 0.3, c: 0.2 } }],
    ["probabilities that don't sum to 1", { ...good, probabilities: { a: 0.5, b: 0.1 } }],
    ["a choice that isn't the most likely", { ...good, probabilities: { a: 0.3, b: 0.7 } }],
    ["confidence out of range", { ...good, confidence: 1.5 }],
    ["probabilities that aren't an object", { ...good, probabilities: "ab" }],
    ["nothing at all", undefined],
  ])("rejects %s", (_name, answer) => {
    expect(() => validateChoice(answer, ids)).toThrow(JevError);
  });
});

describe("validateKey", () => {
  it("resolves for a working key and throws key_rejected for a bad one", async () => {
    await expect(
      validateKey("ts_key_12345678", {
        fetch: async () => json(200, { ...OK, answers: { ok: { type: "noul", noul: 0.99 } } }),
      }),
    ).resolves.toBeUndefined();
    await expect(
      validateKey("ts_bad_12345678", { fetch: async () => json(401, {}) }),
    ).rejects.toMatchObject({ code: "key_rejected" });
  });
});
