import { z } from "zod";

/** First frame the extension sends to the MCP server to authenticate. */
export const HelloFrame = z.object({
  type: z.literal("hello"),
  token: z.string().min(1),
  browser: z.string(),
});
export type HelloFrame = z.infer<typeof HelloFrame>;
