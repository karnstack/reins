import { z } from "zod";
import { Tier } from "./policy.js";

/** A browser tab as seen by the agent. browserId/browser are tagged by the
 *  daemon when aggregating tabs across several connected browsers. */
export const Tab = z.object({
  tabId: z.number(),
  title: z.string(),
  url: z.string(),
  active: z.boolean(),
  /** true when the tab's host is policy-denied: title/url are redacted. */
  blocked: z.boolean().optional(),
  browserId: z.string().optional(),
  browser: z.string().optional(),
});
export type Tab = z.infer<typeof Tab>;

/** A browser connected to the daemon's bridge. */
export const BrowserInfo = z.object({
  id: z.string(),
  browser: z.string(),
  connectedAt: z.number(),
});
export type BrowserInfo = z.infer<typeof BrowserInfo>;

/** Structured error carried by a failed response. */
export const FrameError = z.object({ code: z.string(), message: z.string() });
export type FrameError = z.infer<typeof FrameError>;

/** Optional target metadata the extension stamps on a response: the
 *  resolved tab/host/tier the command actually hit. Consumed by the
 *  daemon's audit trail. Absent on daemon-side failures and on responses
 *  from extensions older than this field. */
export const ResponseMeta = z.object({
  host: z.string().optional(),
  tier: Tier.optional(),
  tabId: z.number().optional(),
});
export type ResponseMeta = z.infer<typeof ResponseMeta>;

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
  meta: ResponseMeta.optional(),
});
export type ResponseFrame = z.infer<typeof ResponseFrame>;

/** Server → extension: handshake acknowledgement. version/browserId let the
 *  popup show what it connected to and who it is on the daemon's roster. */
export const WelcomeFrame = z.object({
  type: z.literal("welcome"),
  server: z.string(),
  version: z.string().optional(),
  browserId: z.string().optional(),
});
export type WelcomeFrame = z.infer<typeof WelcomeFrame>;

/** Result payload for the `list_tabs` method. */
export const ListTabsResult = z.object({ tabs: z.array(Tab) });
export type ListTabsResult = z.infer<typeof ListTabsResult>;
