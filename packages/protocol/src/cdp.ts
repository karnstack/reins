import { z } from "zod";

/** Optional target tab; defaults (server/extension side) to the active tab. */
const tabId = z.number().optional();
/** Optional target browser; required only when several browsers are connected. */
const browserId = z.string().optional();

export const ListTabsParams = z.object({ browserId });
export type ListTabsParams = z.infer<typeof ListTabsParams>;

export const NavigateParams = z.object({
  browserId,
  tabId,
  /** A URL, or one of "back" | "forward" | "reload". */
  to: z.string().min(1),
});
export type NavigateParams = z.infer<typeof NavigateParams>;

export const NavigateResult = z.object({ url: z.string() });
export type NavigateResult = z.infer<typeof NavigateResult>;

export const SnapshotParams = z.object({
  browserId,
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
  browserId,
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
  browserId,
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
  browserId,
  url: z.string().min(1),
  activate: z.boolean().default(true),
});
export type OpenTabParams = z.infer<typeof OpenTabParams>;

export const OpenTabResult = z.object({ tabId: z.number() });
export type OpenTabResult = z.infer<typeof OpenTabResult>;

export const CloseTabParams = z.object({ browserId, tabId: z.number() });
export type CloseTabParams = z.infer<typeof CloseTabParams>;

export const SelectTabParams = z.object({ browserId, tabId: z.number() });
export type SelectTabParams = z.infer<typeof SelectTabParams>;

export const ScreenshotParams = z.object({
  browserId,
  tabId,
  fullPage: z.boolean().default(false),
  format: z.enum(["png", "jpeg"]).default("png"),
});
export type ScreenshotParams = z.infer<typeof ScreenshotParams>;

export const ScreenshotResult = z.object({ data: z.string(), mimeType: z.string() });
export type ScreenshotResult = z.infer<typeof ScreenshotResult>;

export const EvalParams = z.object({
  browserId,
  tabId,
  expression: z.string().min(1),
  awaitPromise: z.boolean().default(false),
});
export type EvalParams = z.infer<typeof EvalParams>;

export const EvalResult = z.object({ value: z.unknown() });
export type EvalResult = z.infer<typeof EvalResult>;

export const WaitForShape = {
  browserId,
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

// ─── Page-control schemas ────────────────────────────────────────────────────

export const PressKeyParams = z.object({
  browserId,
  tabId,
  /** "[Meta+|Ctrl+|Alt+|Shift+]<Key>", e.g. "Escape", "Meta+A", "Shift+Tab". */
  key: z.string().min(1),
});
export type PressKeyParams = z.infer<typeof PressKeyParams>;

export const HoverParams = z
  .object({
    browserId,
    tabId,
    ref: z.string().optional(),
    selector: z.string().optional(),
  })
  .refine((v) => v.ref !== undefined || v.selector !== undefined, {
    message: "hover requires a ref or a selector",
  });
export type HoverParams = z.infer<typeof HoverParams>;

export const ScrollParams = z
  .object({
    browserId,
    tabId,
    ref: z.string().optional(),
    selector: z.string().optional(),
    by: z.object({ dx: z.number(), dy: z.number() }).optional(),
    to: z.enum(["top", "bottom"]).optional(),
  })
  .refine(
    (v) =>
      v.ref !== undefined || v.selector !== undefined || v.by !== undefined || v.to !== undefined,
    {
      message: "scroll requires a ref, a selector, by, or to",
    },
  );
export type ScrollParams = z.infer<typeof ScrollParams>;

export const FillParams = z
  .object({
    browserId,
    tabId,
    ref: z.string().optional(),
    selector: z.string().optional(),
    value: z.string(),
  })
  .refine((v) => v.ref !== undefined || v.selector !== undefined, {
    message: "fill requires a ref or a selector",
  });
export type FillParams = z.infer<typeof FillParams>;

export const SelectOptionParams = z
  .object({
    browserId,
    tabId,
    ref: z.string().optional(),
    selector: z.string().optional(),
    value: z.string(),
  })
  .refine((v) => v.ref !== undefined || v.selector !== undefined, {
    message: "select requires a ref or a selector",
  });
export type SelectOptionParams = z.infer<typeof SelectOptionParams>;

export const UploadParams = z
  .object({
    browserId,
    tabId,
    ref: z.string().optional(),
    selector: z.string().optional(),
    /** Absolute paths on this machine (browser and daemon share it). */
    files: z.array(z.string().min(1)).min(1),
  })
  .refine((v) => v.ref !== undefined || v.selector !== undefined, {
    message: "upload requires a ref or a selector",
  });
export type UploadParams = z.infer<typeof UploadParams>;

/** No ref/selector → whole page (document.body.innerText). */
export const ReadTextParams = z.object({
  browserId,
  tabId,
  ref: z.string().optional(),
  selector: z.string().optional(),
  maxChars: z.number().int().positive().optional(),
});
export type ReadTextParams = z.infer<typeof ReadTextParams>;

export const ReadTextResult = z.object({ text: z.string() });
export type ReadTextResult = z.infer<typeof ReadTextResult>;

/** Resizes the tab's browser window (real resize, not CDP emulation). */
export const ResizeParams = z.object({
  browserId,
  tabId,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});
export type ResizeParams = z.infer<typeof ResizeParams>;

/** Responds to the JavaScript dialog currently open on the tab. */
export const DialogParams = z.object({
  browserId,
  tabId,
  accept: z.boolean(),
  promptText: z.string().optional(),
});
export type DialogParams = z.infer<typeof DialogParams>;

/** Raw Chrome DevTools Protocol passthrough — the escape hatch. */
export const CdpParams = z.object({
  browserId,
  tabId,
  method: z.string().regex(/^[A-Za-z]+\.[A-Za-z]+$/, "expected Domain.method"),
  params: z.record(z.string(), z.unknown()).optional(),
});
export type CdpParams = z.infer<typeof CdpParams>;

export const CdpResult = z.object({ result: z.unknown() });
export type CdpResult = z.infer<typeof CdpResult>;

// ─── M3 event-buffer schemas ─────────────────────────────────────────────────

export const ConsoleEntry = z.object({
  /** CDP console type: "log"|"info"|"warning"|"error"|"debug"|... (permissive) */
  level: z.string(),
  text: z.string(),
  timestamp: z.number(),
});
export type ConsoleEntry = z.infer<typeof ConsoleEntry>;

export const NetworkEntry = z.object({
  method: z.string(),
  url: z.string(),
  status: z.number().optional(),
  timestamp: z.number(),
});
export type NetworkEntry = z.infer<typeof NetworkEntry>;

export const ConsoleParams = z.object({
  browserId,
  tabId,
  sinceMs: z.number().optional(),
  levels: z.array(z.string()).optional(),
});
export type ConsoleParams = z.infer<typeof ConsoleParams>;

export const NetworkParams = z.object({
  browserId,
  tabId,
  sinceMs: z.number().optional(),
  urlPattern: z.string().optional(),
});
export type NetworkParams = z.infer<typeof NetworkParams>;

export const ConsoleResult = z.object({ entries: z.array(ConsoleEntry) });
export type ConsoleResult = z.infer<typeof ConsoleResult>;

export const NetworkResult = z.object({ entries: z.array(NetworkEntry) });
export type NetworkResult = z.infer<typeof NetworkResult>;
