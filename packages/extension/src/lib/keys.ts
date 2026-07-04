/** Key-spec parsing for press_key: "[Meta+|Ctrl+|Alt+|Shift+]<Key>". */

export interface KeyEventSpec {
  key: string;
  code: string;
  keyCode: number;
  /** CDP modifier bitmask: Alt=1, Ctrl=2, Meta=4, Shift=8. */
  modifiers: number;
}

const NAMED: Record<string, Omit<KeyEventSpec, "modifiers">> = {
  enter: { key: "Enter", code: "Enter", keyCode: 13 },
  escape: { key: "Escape", code: "Escape", keyCode: 27 },
  esc: { key: "Escape", code: "Escape", keyCode: 27 },
  tab: { key: "Tab", code: "Tab", keyCode: 9 },
  backspace: { key: "Backspace", code: "Backspace", keyCode: 8 },
  delete: { key: "Delete", code: "Delete", keyCode: 46 },
  arrowup: { key: "ArrowUp", code: "ArrowUp", keyCode: 38 },
  arrowdown: { key: "ArrowDown", code: "ArrowDown", keyCode: 40 },
  arrowleft: { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 },
  arrowright: { key: "ArrowRight", code: "ArrowRight", keyCode: 39 },
  home: { key: "Home", code: "Home", keyCode: 36 },
  end: { key: "End", code: "End", keyCode: 35 },
  pageup: { key: "PageUp", code: "PageUp", keyCode: 33 },
  pagedown: { key: "PageDown", code: "PageDown", keyCode: 34 },
  space: { key: " ", code: "Space", keyCode: 32 },
};

const MODS: Record<string, number> = {
  alt: 1,
  option: 1,
  ctrl: 2,
  control: 2,
  meta: 4,
  cmd: 4,
  command: 4,
  shift: 8,
};

export function parseKeySpec(spec: string): KeyEventSpec {
  const parts = spec.split("+");
  const keyPart = parts.pop() ?? "";
  let modifiers = 0;
  for (const part of parts) {
    const bit = MODS[part.toLowerCase()];
    if (bit === undefined) throw new Error(`unknown modifier: ${part}`);
    modifiers |= bit;
  }
  const named = NAMED[keyPart.toLowerCase()];
  if (named) return { ...named, modifiers };
  if (/^[a-zA-Z]$/.test(keyPart)) {
    const upper = keyPart.toUpperCase();
    return { key: keyPart, code: `Key${upper}`, keyCode: upper.charCodeAt(0), modifiers };
  }
  if (/^[0-9]$/.test(keyPart)) {
    return { key: keyPart, code: `Digit${keyPart}`, keyCode: keyPart.charCodeAt(0), modifiers };
  }
  throw new Error(`unknown key: ${keyPart || "(empty)"}`);
}
