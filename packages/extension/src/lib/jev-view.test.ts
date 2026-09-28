import { describe, expect, it } from "vitest";
import { jevMaskedKey, jevStateFrom, jevViewFlags } from "./jev-view.js";

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
    expect(jevMaskedKey("a1b2")).toBe("••••a1b2");
  });
  it("reports an unreadable status", () => {
    expect(jevStateFrom(true, { nope: 1 }).kind).toBe("error");
  });
});

describe("popup Jev view flags", () => {
  it("offline: form shown but disabled, offline note visible, nothing else", () => {
    expect(jevViewFlags({ kind: "offline" }, false)).toEqual({
      pitchHidden: false,
      readyHidden: true,
      formHidden: false,
      actionsHidden: true,
      cancelHidden: true,
      offlineHidden: false,
      disabled: true,
      error: undefined,
    });
  });
  it("unset: pitch + enabled form", () => {
    expect(jevViewFlags({ kind: "unset" }, false)).toMatchObject({
      pitchHidden: false,
      formHidden: false,
      actionsHidden: true,
      cancelHidden: true,
      offlineHidden: true,
      disabled: false,
    });
  });
  it("set: ready line + Replace/Remove, form hidden", () => {
    expect(jevViewFlags({ kind: "set", last4: "a1b2" }, false)).toMatchObject({
      pitchHidden: true,
      readyHidden: false,
      formHidden: true,
      actionsHidden: false,
      cancelHidden: true,
    });
  });
  it("saving disables the form, Cancel included, until the save settles", () => {
    expect(jevViewFlags({ kind: "set", last4: "a1b2" }, true, true)).toMatchObject({
      cancelHidden: false,
      disabled: true,
    });
    expect(jevViewFlags({ kind: "unset" }, false, true).disabled).toBe(true);
    expect(jevViewFlags({ kind: "set", last4: "a1b2" }, true, false).disabled).toBe(false);
  });
  it("set + replacing: form and Cancel shown, Replace/Remove hidden, no pitch", () => {
    expect(jevViewFlags({ kind: "set", last4: "a1b2" }, true)).toMatchObject({
      pitchHidden: true,
      readyHidden: false,
      formHidden: false,
      actionsHidden: true,
      cancelHidden: false,
      disabled: false,
    });
  });
  it("replacing is irrelevant when no key is set", () => {
    expect(jevViewFlags({ kind: "unset" }, true).cancelHidden).toBe(true);
  });
  it("error: message surfaced, form stays usable", () => {
    expect(jevViewFlags({ kind: "error", message: "boom" }, false)).toMatchObject({
      disabled: false,
      offlineHidden: true,
      error: "boom",
    });
  });
  it("a save in flight keeps the form disabled even when connected", () => {
    expect(jevViewFlags({ kind: "unset" }, false, true).disabled).toBe(true);
  });
});
