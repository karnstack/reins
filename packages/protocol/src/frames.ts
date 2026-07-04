import { z } from "zod";

/** First frame the extension sends to the daemon to identify itself.
 *  Authentication is the WS Origin header (exact extension-ID allowlist),
 *  not a token — see the 2026-07-04 daemon spec. */
export const HelloFrame = z.object({
  type: z.literal("hello"),
  browser: z.string(),
});
export type HelloFrame = z.infer<typeof HelloFrame>;
