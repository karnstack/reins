import type { ConsoleEntry, ConsoleParams, NetworkEntry, NetworkParams } from "@reins/protocol";

export function filterConsole(entries: ConsoleEntry[], params: ConsoleParams): ConsoleEntry[] {
  return entries.filter((e) => {
    if (params.sinceMs !== undefined && e.timestamp < params.sinceMs) return false;
    if (params.levels && params.levels.length > 0 && !params.levels.includes(e.level)) return false;
    return true;
  });
}

export function filterNetwork(entries: NetworkEntry[], params: NetworkParams): NetworkEntry[] {
  return entries.filter((e) => {
    if (params.sinceMs !== undefined && e.timestamp < params.sinceMs) return false;
    if (params.urlPattern && !e.url.includes(params.urlPattern)) return false;
    return true;
  });
}
