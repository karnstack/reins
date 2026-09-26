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

export function jevReadyText(last4: string): string {
  return `Jev ready · ••••${last4}`;
}
