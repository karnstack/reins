import type { JevAction } from "@reins/protocol";
import { describe, expect, it } from "vitest";
import { fingerprint, noProgress, riskyReason, sameSite } from "./rules.js";

const click = (label: string, role = "button"): JevAction => ({
  id: "e1",
  kind: "click",
  node: 1,
  role,
  label,
});

describe("riskyReason", () => {
  it.each([
    ["Pay now", true],
    ["Remove filter", true],
    ["Send message", true],
    ["Place order", true],
    ["Postcode", false],
    ["Search", false],
    ["Submit", false],
    ["Continue", false],
    ["Senders", false],
  ])("%s → risky=%s", (label, risky) => {
    expect(riskyReason(click(label), "find flights", []) !== undefined).toBe(risky);
  });

  it("an unlabeled button is risky", () => {
    expect(riskyReason(click("button"), "x", [])).toBe("it has no label");
    expect(riskyReason(click(""), "x", [])).toBe("it has no label");
  });

  it("--confirm allows that exact label", () => {
    expect(riskyReason(click("Pay now"), "x", ["pay  NOW"])).toBeUndefined();
  });

  it("--confirm never waives an unlabeled button", () => {
    expect(riskyReason(click("button"), "x", ["button"])).toBe("it has no label");
    expect(riskyReason(click(""), "x", [""])).toBe("it has no label");
    expect(riskyReason(click(""), "x", ["   "])).toBe("it has no label");
  });

  it("a label the goal says word for word is allowed; a bigger one isn't", () => {
    expect(riskyReason(click("Pay now"), "pay now for the 9:40 flight", [])).toBeUndefined();
    expect(riskyReason(click("Delete account"), "delete the spam", [])).toBeDefined();
  });

  it("a label inside another word of the goal is not allowed", () => {
    expect(riskyReason(click("Order"), "reorder the list", [])).toBeDefined();
    expect(riskyReason(click("Send"), "resend the code", [])).toBeDefined();
    expect(riskyReason(click("Post"), "enter postcode 90210", [])).toBeDefined();
    expect(riskyReason(click("Pay"), "paypal login", [])).toBeDefined();
    expect(riskyReason(click("Pay (now)"), "pay (now) please", [])).toBeUndefined();
  });

  it("only clicks are risky", () => {
    const fill: JevAction = { id: "e2", kind: "fill", node: 2, role: "textbox", label: "Send to" };
    expect(riskyReason(fill, "x", [])).toBeUndefined();
    expect(riskyReason({ ...fill, label: "" }, "x", [])).toBeUndefined();
  });
});

describe("sameSite", () => {
  it.each([
    ["www.google.com", "www.google.com", true],
    ["google.com", "www.google.com", true],
    ["www.google.com", "google.com", true],
    ["www.google.com", "accounts.google.com", false],
    ["bank.com", "evil.com", false],
    ["bank.com", undefined, true],
    [undefined, "x.com", true],
  ])("%s → %s: %s", (a, b, same) => {
    expect(sameSite(a, b)).toBe(same);
  });
});

describe("noProgress", () => {
  const h = (pageChanged: boolean | null, op: "click" | "wait" = "click") => ({
    op,
    label: "x",
    pageChanged,
  });
  it("fires after 3 non-wait actions without change", () => {
    expect(noProgress([h(false), h(false), h(false)])).toBe(true);
    expect(noProgress([h(false), h(true), h(false)])).toBe(false);
    expect(noProgress([h(false), h(false, "wait"), h(false)])).toBe(false);
    expect(noProgress([h(false), h(false)])).toBe(false);
  });
});

describe("fingerprint", () => {
  it("is stable for identical pages and changes with text", () => {
    const obs = { url: "u", title: "t", text: "x", visible: true, actions: [] };
    expect(fingerprint(obs)).toBe(fingerprint({ ...obs }));
    expect(fingerprint(obs)).not.toBe(fingerprint({ ...obs, text: "y" }));
  });
  it("does not change with visibility or title alone", () => {
    const obs = { url: "u", title: "t", text: "x", visible: true, actions: [] };
    expect(fingerprint(obs)).toBe(fingerprint({ ...obs, visible: false, title: "t2" }));
  });
});
