import { KeyStatus } from "@reins/protocol";

export type JevKeyState =
  | { kind: "offline" }
  | { kind: "unset" }
  | { kind: "set"; last4: string }
  | { kind: "error"; message: string };

export function jevStateFrom(connected: boolean, status: unknown): JevKeyState {
  if (!connected) return { kind: "offline" };
  const parsed = KeyStatus.safeParse(status);
  if (!parsed.success) {
    return { kind: "error", message: "couldn't read the key status from the reins daemon" };
  }
  return parsed.data.set ? { kind: "set", last4: parsed.data.last4 ?? "????" } : { kind: "unset" };
}

/** The key as the popup shows it next to "Ready": masked but for the last 4. */
export function jevMaskedKey(last4: string): string {
  return `••••${last4}`;
}

/** Which Jev controls show / are usable for a state. Pure so it's testable:
 *  popup.ts only copies these onto the DOM. `saving` keeps the form locked
 *  while a key_set is in flight, whatever a concurrent re-render says. */
export interface JevViewFlags {
  pitchHidden: boolean;
  readyHidden: boolean;
  formHidden: boolean;
  actionsHidden: boolean;
  cancelHidden: boolean;
  offlineHidden: boolean;
  disabled: boolean;
  error: string | undefined;
}

export function jevViewFlags(state: JevKeyState, replacing: boolean, saving = false): JevViewFlags {
  const set = state.kind === "set";
  const editing = set && replacing;
  return {
    pitchHidden: set && !editing,
    readyHidden: !set,
    formHidden: set && !editing,
    actionsHidden: !set || editing,
    cancelHidden: !editing,
    offlineHidden: state.kind !== "offline",
    disabled: state.kind === "offline" || saving,
    error: state.kind === "error" ? state.message : undefined,
  };
}
