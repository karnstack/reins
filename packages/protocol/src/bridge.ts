import { z } from "zod";
import { Tier } from "./policy.js";

/** A browser tab as seen by the agent. browserId/browser are tagged by the
 *  daemon when aggregating tabs across several connected browsers. */
export const Tab = z.object({
  tabId: z.number(),
  title: z.string(),
  url: z.string(),
  active: z.boolean(),
  /** The tab's group, when it is in one (omitted when ungrouped, or when the
   *  browser has no tab groups). */
  groupId: z.number().optional(),
  /** true when the tab's host is policy-denied: title/url are redacted. */
  blocked: z.boolean().optional(),
  browserId: z.string().optional(),
  browser: z.string().optional(),
});
export type Tab = z.infer<typeof Tab>;

/** Chromium's fixed tab-group palette. */
export const TabGroupColor = z.enum([
  "grey",
  "blue",
  "red",
  "yellow",
  "green",
  "pink",
  "purple",
  "cyan",
  "orange",
]);
export type TabGroupColor = z.infer<typeof TabGroupColor>;

/** A tab group. browserId/browser are tagged by the daemon when aggregating
 *  across several connected browsers. */
export const TabGroup = z.object({
  groupId: z.number(),
  title: z.string(),
  // Lenient on output so a future Chromium color doesn't reject the whole
  // list; inputs stay on TabGroupColor.
  color: z.string(),
  collapsed: z.boolean(),
  windowId: z.number(),
  tabCount: z.number(),
  browserId: z.string().optional(),
  browser: z.string().optional(),
});
export type TabGroup = z.infer<typeof TabGroup>;

/** A browser connected to the daemon's bridge. */
export const BrowserInfo = z.object({
  id: z.string(),
  browser: z.string(),
  connectedAt: z.number(),
  /** The connected extension's version, when its hello carried one. */
  version: z.string().optional(),
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

/** Extension → server: invoke one of the few daemon methods the extension may
 *  call (the popup's key management). Answered with a ResponseFrame carrying
 *  the same id. The daemon refuses any method outside CALL_METHODS. */
export const CallFrame = z.object({
  type: z.literal("call"),
  id: z.string().min(1),
  method: z.string().min(1),
  params: z.unknown(),
});
export type CallFrame = z.infer<typeof CallFrame>;

/** The only methods a `call` frame may invoke. */
export const CALL_METHODS = ["key_set", "key_status", "key_clear"] as const;
export type CallMethod = (typeof CALL_METHODS)[number];

/** Services reins stores an API key for. */
export const KeyProvider = z.enum(["typesafe"]);
export type KeyProvider = z.infer<typeof KeyProvider>;

export const KeySetParams = z.object({
  provider: KeyProvider.default("typesafe"),
  key: z.string().trim().min(8, "that doesn't look like an API key"),
});
export type KeySetParams = z.infer<typeof KeySetParams>;

export const KeyProviderParams = z.object({ provider: KeyProvider.default("typesafe") });
export type KeyProviderParams = z.infer<typeof KeyProviderParams>;

/** What anyone may learn about a stored key: whether it's set, and its last 4. */
export const KeyStatus = z.object({
  provider: KeyProvider,
  set: z.boolean(),
  last4: z.string().optional(),
});
export type KeyStatus = z.infer<typeof KeyStatus>;

/** Result payload for the `list_tabs` method. */
export const ListTabsResult = z.object({ tabs: z.array(Tab) });
export type ListTabsResult = z.infer<typeof ListTabsResult>;

/** A browser the daemon left out of a `list_groups` aggregate, and why:
 *  no chrome.tabGroups API, an extension that predates tab groups, or a
 *  plain failure. */
export const SkippedBrowser = z.object({
  browserId: z.string(),
  browser: z.string(),
  reason: z.enum(["unsupported", "outdated", "error"]),
  message: z.string(),
});
export type SkippedBrowser = z.infer<typeof SkippedBrowser>;

/** Result payload for the `list_groups` method. `skipped` is added only by
 *  the daemon's aggregate; the extension never sends it. */
export const ListGroupsResult = z.object({
  groups: z.array(TabGroup),
  skipped: z.array(SkippedBrowser).optional(),
});
export type ListGroupsResult = z.infer<typeof ListGroupsResult>;
