import { CALL_METHODS, KeyProviderParams, KeySetParams, type KeyStatus } from "@reins/protocol";
import { validateKey } from "./client.js";
import { clearKey, keyStatus, writeKey } from "./credentials.js";

/** Key methods, answered by the daemon itself — never forwarded to a browser. */
export const KEY_METHODS: ReadonlySet<string> = new Set(CALL_METHODS);

export interface KeyService {
  handle(method: string, params: unknown): Promise<KeyStatus>;
}

export function createKeyService(opts: {
  dir: string;
  validate?: (key: string) => Promise<void>;
}): KeyService {
  const validate = opts.validate ?? ((key: string) => validateKey(key));
  return {
    async handle(method, params) {
      if (method === "key_set") {
        const { provider, key } = KeySetParams.parse(params ?? {});
        await validate(key); // a rejected key is never written
        writeKey(opts.dir, key, provider);
        return keyStatus(opts.dir, provider);
      }
      if (method === "key_status") {
        return keyStatus(opts.dir, KeyProviderParams.parse(params ?? {}).provider);
      }
      if (method === "key_clear") {
        const { provider } = KeyProviderParams.parse(params ?? {});
        clearKey(opts.dir, provider);
        return keyStatus(opts.dir, provider);
      }
      throw new Error(`unknown key method: ${method}`);
    },
  };
}
