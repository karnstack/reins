import { z } from "zod";

/** Optional target tab; defaults (server/extension side) to the active tab. */
const tabId = z.number().optional();

export const NavigateParams = z.object({
  tabId,
  /** A URL, or one of "back" | "forward" | "reload". */
  to: z.string().min(1),
});
export type NavigateParams = z.infer<typeof NavigateParams>;

export const NavigateResult = z.object({ url: z.string() });
export type NavigateResult = z.infer<typeof NavigateResult>;

export const SnapshotParams = z.object({
  tabId,
  mode: z.enum(["text", "a11y", "dom"]).default("a11y"),
  maxChars: z.number().optional(),
});
export type SnapshotParams = z.infer<typeof SnapshotParams>;

export const SnapshotRef = z.object({
  ref: z.string(),
  role: z.string().optional(),
  name: z.string().optional(),
});
export type SnapshotRef = z.infer<typeof SnapshotRef>;

export const SnapshotResult = z.object({
  content: z.string(),
  refs: z.array(SnapshotRef),
});
export type SnapshotResult = z.infer<typeof SnapshotResult>;

export const ClickShape = {
  tabId,
  ref: z.string().optional(),
  selector: z.string().optional(),
  button: z.enum(["left", "right", "middle"]).default("left"),
  clickCount: z.number().int().min(1).default(1),
} as const;

export const ClickParams = z
  .object(ClickShape)
  .refine((v) => v.ref !== undefined || v.selector !== undefined, {
    message: "click requires a ref or a selector",
  });
export type ClickParams = z.infer<typeof ClickParams>;

export const TypeShape = {
  tabId,
  ref: z.string().optional(),
  selector: z.string().optional(),
  text: z.string(),
  submit: z.boolean().default(false),
} as const;

export const TypeParams = z
  .object(TypeShape)
  .refine((v) => v.ref !== undefined || v.selector !== undefined, {
    message: "type requires a ref or a selector",
  });
export type TypeParams = z.infer<typeof TypeParams>;

export const OkResult = z.object({ ok: z.literal(true) });
export type OkResult = z.infer<typeof OkResult>;

export const OpenTabParams = z.object({
  url: z.string().min(1),
  activate: z.boolean().default(true),
});
export type OpenTabParams = z.infer<typeof OpenTabParams>;

export const OpenTabResult = z.object({ tabId: z.number() });
export type OpenTabResult = z.infer<typeof OpenTabResult>;

export const CloseTabParams = z.object({ tabId: z.number() });
export type CloseTabParams = z.infer<typeof CloseTabParams>;

export const SelectTabParams = z.object({ tabId: z.number() });
export type SelectTabParams = z.infer<typeof SelectTabParams>;

export const ScreenshotParams = z.object({
  tabId,
  fullPage: z.boolean().default(false),
  format: z.enum(["png", "jpeg"]).default("png"),
});
export type ScreenshotParams = z.infer<typeof ScreenshotParams>;

export const ScreenshotResult = z.object({ data: z.string(), mimeType: z.string() });
export type ScreenshotResult = z.infer<typeof ScreenshotResult>;

export const EvalParams = z.object({
  tabId,
  expression: z.string().min(1),
  awaitPromise: z.boolean().default(false),
});
export type EvalParams = z.infer<typeof EvalParams>;

export const EvalResult = z.object({ value: z.unknown() });
export type EvalResult = z.infer<typeof EvalResult>;

export const WaitForShape = {
  tabId,
  selector: z.string().optional(),
  ref: z.string().optional(),
  state: z.enum(["visible", "hidden", "present"]).default("visible"),
  timeoutMs: z.number().int().positive().default(5000),
} as const;

export const WaitForParams = z
  .object(WaitForShape)
  .refine((v) => v.ref !== undefined || v.selector !== undefined, {
    message: "wait_for requires a ref or a selector",
  });
export type WaitForParams = z.infer<typeof WaitForParams>;
