import { z } from "zod";

const tabId = z.number().optional();
const browserId = z.string().optional();

/** One thing Jev may choose: an operation on an observed element, or a page-level control. */
export const JevActionKind = z.enum(["click", "fill", "select", "scroll", "wait"]);
export type JevActionKind = z.infer<typeof JevActionKind>;

export const JevAction = z.object({
  id: z.string(),
  kind: JevActionKind,
  /** Page-side identity of the element (absent for scroll/wait). */
  node: z.number().optional(),
  role: z.string().optional(),
  label: z.string(),
  value: z.string().optional(),
  current_value: z.string().optional(),
  checked: z.string().optional(),
  selected: z.string().optional(),
  expanded: z.string().optional(),
  delta: z.number().optional(),
  /** A fill whose field may be submitted with Enter (search-like fields only). */
  submit: z.boolean().optional(),
});
export type JevAction = z.infer<typeof JevAction>;

export const JevDialog = z.object({ type: z.string(), message: z.string() });
export type JevDialog = z.infer<typeof JevDialog>;

export const JevObservation = z.object({
  url: z.string(),
  title: z.string(),
  /** Visible viewport text, capped (~6,000 chars). */
  text: z.string(),
  /** document.visibilityState === "visible". */
  visible: z.boolean(),
  actions: z.array(JevAction),
  /** Set when a JS alert/confirm/prompt blocks the page. */
  dialog: JevDialog.optional(),
});
export type JevObservation = z.infer<typeof JevObservation>;

export const JevObserveParams = z.object({ browserId, tabId });
export type JevObserveParams = z.infer<typeof JevObserveParams>;

export const JevActParams = z.object({
  browserId,
  tabId,
  op: z.enum(["click", "type", "select", "submit", "scroll", "wait"]),
  node: z.number().optional(),
  /** The chosen element's label, for the audit trail; the extension ignores it. */
  label: z.string().optional(),
  /** Typed text. Named `text` so the audit trail redacts it. */
  text: z.string().optional(),
  /** Native <select> option value (also redacted in the audit trail). */
  value: z.string().optional(),
  delta: z.number().optional(),
});
export type JevActParams = z.infer<typeof JevActParams>;

export const JevActResult = z.union([
  z.object({ ok: z.literal(true) }),
  z.object({ stale: z.literal(true), reason: z.string() }),
]);
export type JevActResult = z.infer<typeof JevActResult>;
