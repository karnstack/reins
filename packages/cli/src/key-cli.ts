import { KeyStatus } from "@reins/protocol";
import { UsageError } from "./args.js";

export const KEY_USAGE = "usage: reins key set|status|clear [typesafe]";

const DISCLOSURE =
  "reins do sends page text, element labels and your --fill values from the tab it drives to TypeSafe, under this key. Nothing is sent until you run reins do. https://reins.tech/docs/security#reins-do";

export function keyLine(s: KeyStatus): string {
  return s.set ? `${s.provider}: set (••••${s.last4 ?? "????"})` : `${s.provider}: not set`;
}

export async function runKey(
  argv: string[],
  deps: {
    rpc(method: string, params: Record<string, unknown>): Promise<unknown>;
    readSecret(prompt: string): Promise<string>;
  },
): Promise<string> {
  const [sub, provider = "typesafe", ...extra] = argv;
  if (provider !== "typesafe" || extra.length > 0) throw new UsageError(KEY_USAGE);
  switch (sub) {
    case "set": {
      const key = (
        await deps.readSecret("TypeSafe API key (https://console.typesafe.ai/keys): ")
      ).trim();
      if (!key) throw new UsageError("no key given");
      const status = KeyStatus.parse(await deps.rpc("key_set", { provider, key }));
      return `${keyLine(status)}\n${DISCLOSURE}`;
    }
    case "status":
      return keyLine(KeyStatus.parse(await deps.rpc("key_status", { provider })));
    case "clear":
      KeyStatus.parse(await deps.rpc("key_clear", { provider }));
      return `${provider}: key removed`;
    default:
      throw new UsageError(KEY_USAGE);
  }
}
