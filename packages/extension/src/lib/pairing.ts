export interface Pairing {
  url: string;
  token: string;
}

const URL_KEY = "reinsUrl";
const TOKEN_KEY = "reinsToken";

/** Load the saved pairing (server URL + token) from extension storage. */
export async function loadPairing(): Promise<Pairing | undefined> {
  const got = await chrome.storage.local.get([URL_KEY, TOKEN_KEY]);
  const url = got[URL_KEY];
  const token = got[TOKEN_KEY];
  if (typeof url === "string" && typeof token === "string") return { url, token };
  return undefined;
}

/** Persist the pairing entered in the popup. */
export async function savePairing(pairing: Pairing): Promise<void> {
  await chrome.storage.local.set({ [URL_KEY]: pairing.url, [TOKEN_KEY]: pairing.token });
}

/** Remove the pairing (kill switch / unpair). */
export async function clearPairing(): Promise<void> {
  await chrome.storage.local.remove([URL_KEY, TOKEN_KEY]);
}
