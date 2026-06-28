import { z } from "zod";

/** A browser tab as seen by the agent. */
export const Tab = z.object({
  tabId: z.number(),
  title: z.string(),
  url: z.string(),
  active: z.boolean(),
});
export type Tab = z.infer<typeof Tab>;

/** Structured error carried by a failed response. */
export const FrameError = z.object({ code: z.string(), message: z.string() });
export type FrameError = z.infer<typeof FrameError>;

/** Server → extension: invoke a method on the browser. */
export const RequestFrame = z.object({
  type: z.literal("request"),
  id: z.string().min(1),
  method: z.string().min(1),
  params: z.unknown(),
});
export type RequestFrame = z.infer<typeof RequestFrame>;

/** Extension → server: result of a request. */
export const ResponseFrame = z.object({
  type: z.literal("response"),
  id: z.string().min(1),
  ok: z.boolean(),
  result: z.unknown().optional(),
  error: FrameError.optional(),
});
export type ResponseFrame = z.infer<typeof ResponseFrame>;

/** Server → extension: handshake acknowledgement. */
export const WelcomeFrame = z.object({
  type: z.literal("welcome"),
  server: z.string(),
});
export type WelcomeFrame = z.infer<typeof WelcomeFrame>;

/** Result payload for the `list_tabs` method. */
export const ListTabsResult = z.object({ tabs: z.array(Tab) });
export type ListTabsResult = z.infer<typeof ListTabsResult>;
