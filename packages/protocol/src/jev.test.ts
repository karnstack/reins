import { describe, expect, it } from "vitest";
import { JevActParams, JevActResult, JevObservation } from "./jev.js";

describe("jev schemas", () => {
  it("parses an observation", () => {
    const obs = {
      url: "https://x.com/",
      title: "X",
      text: "hello",
      visible: true,
      actions: [
        { id: "e1", kind: "fill", node: 3, role: "textbox", label: "Where from?", value: "" },
        { id: "wait", kind: "wait", label: "Wait for the page to update" },
      ],
    };
    expect(JevObservation.parse(obs)).toEqual(obs);
  });

  it("act params carry typed text under `text` (audit-redacted key)", () => {
    expect(JevActParams.parse({ op: "type", node: 3, text: "Zurich" }).text).toBe("Zurich");
    expect(() => JevActParams.parse({ op: "drag" })).toThrow();
  });

  it("act params carry an optional label for the audit trail", () => {
    expect(JevActParams.parse({ op: "click", node: 3, label: "Search" }).label).toBe("Search");
    expect(JevActParams.parse({ op: "click", node: 3 }).label).toBeUndefined();
  });

  it("act result is ok or stale", () => {
    expect(JevActResult.parse({ ok: true })).toEqual({ ok: true });
    expect(JevActResult.parse({ stale: true, reason: "gone" })).toEqual({
      stale: true,
      reason: "gone",
    });
    expect(() => JevActResult.parse({})).toThrow();
  });
});
