import { describe, expect, it } from "vitest";
import { jevReadyText, jevStateFrom } from "./jev-view.js";

describe("popup Jev state", () => {
  it("is offline when the daemon isn't connected", () => {
    expect(jevStateFrom(false, undefined)).toEqual({ kind: "offline" });
  });
  it("shows the pitch when no key is set", () => {
    expect(jevStateFrom(true, { provider: "typesafe", set: false })).toEqual({ kind: "unset" });
  });
  it("shows the last 4 when set", () => {
    expect(jevStateFrom(true, { provider: "typesafe", set: true, last4: "a1b2" })).toEqual({
      kind: "set",
      last4: "a1b2",
    });
    expect(jevReadyText("a1b2")).toBe("Jev ready · ••••a1b2");
  });
  it("reports an unreadable status", () => {
    expect(jevStateFrom(true, { nope: 1 }).kind).toBe("error");
  });
});
