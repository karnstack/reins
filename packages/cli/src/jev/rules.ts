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

const RISKY_RE = new RegExp(`\\b(${RISKY_WORDS.join("|")})\\b`, "i");

export function normalizeLabel(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Why this click must be confirmed first, or undefined when it may go ahead. */
export function riskyReason(
  action: JevAction,
  goal: string,
  confirms: string[],
): string | undefined {
  const label = normalizeLabel(action.label);
  if (confirms.some((c) => normalizeLabel(c) === label)) return undefined;
  if (label === "" || label === normalizeLabel(action.role ?? "")) return "it has no label";
  const m = RISKY_RE.exec(label);
  if (!m) return undefined;
  if (normalizeLabel(goal).includes(label)) return undefined;
  return `its label says "${(m[1] as string).toLowerCase()}"`;
}

/** Same host, or one is a subdomain of the other. No public-suffix list:
 *  a login redirect to another host stops the run, which is fine. */
export function sameSite(start: string | undefined, host: string | undefined): boolean {
  if (start === undefined || host === undefined) return true;
  return host === start || host.endsWith(`.${start}`) || start.endsWith(`.${host}`);
}

/** 3 consecutive non-WAIT actions whose next read showed no change. */
export function noProgress(history: HistoryEntry[]): boolean {
  const last = history.slice(-3);
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
