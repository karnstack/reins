import { createHash } from "node:crypto";
import type { JevAction, JevObservation } from "@reins/protocol";
import type { HistoryEntry } from "./types.js";

/** Money, messaging and deletion words. Generic submit/confirm/next are left
 *  out on purpose: stopping every form would defeat the command. */
export const RISKY_WORDS = [
  "buy",
  "pay",
  "purchase",
  "order",
  "checkout",
  "send",
  "post",
  "publish",
  "share",
  "invite",
  "delete",
  "remove",
  "transfer",
  "unsubscribe",
  "approve",
  "authorize",
  "accept",
] as const;

// `\b` is the ASCII word boundary on purpose: the list is English, and the
// heuristic is known to have holes (non-English labels are not covered).
const RISKY_RE = new RegExp(`\\b(${RISKY_WORDS.join("|")})\\b`, "i");

export function normalizeLabel(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

/** True when the goal says the whole label, bounded by non-word characters
 *  (letters/digits in any script, and `_`): "pay now for the flight" says
 *  "pay now"; "reorder the list", "prépay the bill" and "pay_now" do not say
 *  "order" / "pay". Only regex syntax characters are escaped: escaping
 *  anything else throws under the `u` flag. */
function goalSaysLabel(goal: string, label: string): boolean {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\p{L}\\p{N}_])${escaped}([^\\p{L}\\p{N}_]|$)`, "u").test(goal);
}

/** Why this click must be confirmed first, or undefined when it may go ahead.
 *  Only clicks are ever risky: a fill into a field labeled "Send to" is fine. */
export function riskyReason(
  action: JevAction,
  goal: string,
  confirms: string[],
): string | undefined {
  if (action.kind !== "click") return undefined;
  const label = normalizeLabel(action.label);
  if (label === "" || label === normalizeLabel(action.role ?? "")) return "it has no label";
  if (confirms.some((c) => normalizeLabel(c) === label)) return undefined;
  const m = RISKY_RE.exec(label);
  if (!m) return undefined;
  if (goalSaysLabel(normalizeLabel(goal), label)) return undefined;
  // "Accept" / "Accept all" in a cookie/consent banner (judged page-side, see
  // jev-snapshot's `consent`) is routine, not risky; every other risky word
  // stays risky there, and "accept" stays risky anywhere else.
  if (action.consent === true && m[1]?.toLowerCase() === "accept") return undefined;
  return `its label says "${(m[1] as string).toLowerCase()}"`;
}

/** Same host, or one is a subdomain of the other. No public-suffix list:
 *  a login redirect to another host stops the run, which is fine. */
export function sameSite(start: string | undefined, host: string | undefined): boolean {
  if (start === undefined || host === undefined) return true;
  return host === start || host.endsWith(`.${start}`) || start.endsWith(`.${host}`);
}

/** 3 consecutive non-WAIT actions whose next read showed no change. A stale
 *  entry never acted, so it neither counts nor breaks the run of three. */
export function noProgress(history: HistoryEntry[]): boolean {
  const last = history.filter((h) => h.stale === undefined).slice(-3);
  return last.length === 3 && last.every((h) => h.op !== "wait" && h.pageChanged === false);
}

/** What counts as "the page changed": url, visible text and the controls.
 *  Scroll position is excluded (the snapshot omits it) because reins' own
 *  scrollIntoView before a click would otherwise count as progress. */
export function fingerprint(obs: JevObservation): string {
  return createHash("sha256")
    .update(JSON.stringify({ url: obs.url, text: obs.text, actions: obs.actions }))
    .digest("hex");
}
