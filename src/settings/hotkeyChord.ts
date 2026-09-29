/**
 * Shortcut grammar shared with `src-tauri/src/platform/windows/push_to_talk.rs`.
 * A binding is one key or mouse button, optionally held with Ctrl, Shift, Alt, or Win.
 * `VK<n>` is the Windows virtual-key code for a key that has no name.
 */

const MODIFIER_ORDER = ["Ctrl", "Shift", "Alt", "Win"] as const;

/** `KeyboardEvent.code` for a modifier, and the generic flag the hook matches. */
const MODIFIER_CODE: Record<string, (typeof MODIFIER_ORDER)[number]> = {
  ControlLeft: "Ctrl",
  ControlRight: "Ctrl",
  ShiftLeft: "Shift",
  ShiftRight: "Shift",
  AltLeft: "Alt",
  AltRight: "Alt",
  MetaLeft: "Win",
  MetaRight: "Win",
};

/** A modifier pressed by itself. The hook sees the left/right virtual key, not the generic one. */
const LONE_MODIFIER_CODE: Record<string, string> = {
  ControlLeft: "LeftCtrl",
  ControlRight: "RightCtrl",
  ShiftLeft: "LeftShift",
  ShiftRight: "RightShift",
  AltLeft: "LeftAlt",
  AltRight: "RightAlt",
  MetaLeft: "LeftWin",
  MetaRight: "RightWin",
};

const KEY_BY_NAME: Record<string, number> = {
  RightAlt: 0xA5,
  LeftAlt: 0xA4,
  RightCtrl: 0xA3,
  LeftCtrl: 0xA2,
  RightShift: 0xA1,
  LeftShift: 0xA0,
  RightWin: 0x5C,
  LeftWin: 0x5B,
  Space: 0x20,
  CapsLock: 0x14,
  ScrollLock: 0x91,
  Pause: 0x13,
  Insert: 0x2D,
  Mouse4: 0x05,
  Mouse5: 0x06,
  MouseMiddle: 0x04,
  MouseRight: 0x02,
  Tab: 0x09,
  Enter: 0x0D,
  Backspace: 0x08,
  Delete: 0x2E,
  Home: 0x24,
  End: 0x23,
  PageUp: 0x21,
  PageDown: 0x22,
  Up: 0x26,
  Down: 0x28,
  Left: 0x25,
  Right: 0x27,
  Backquote: 0xC0,
  Minus: 0xBD,
  Equal: 0xBB,
  BracketLeft: 0xDB,
  BracketRight: 0xDD,
  Backslash: 0xDC,
  Semicolon: 0xBA,
  Quote: 0xDE,
  Comma: 0xBC,
  Period: 0xBE,
  Slash: 0xBF,
  NumpadMultiply: 0x6A,
  NumpadAdd: 0x6B,
  NumpadSubtract: 0x6D,
  NumpadDecimal: 0x6E,
  NumpadDivide: 0x6F,
};

const NAME_ALIASES: Record<string, string> = {
  xbutton1: "Mouse4",
  xbutton2: "Mouse5",
  middle: "MouseMiddle",
  mousemiddle: "MouseMiddle",
  return: "Enter",
};

const KEY_LABELS: Record<string, string> = {
  RightAlt: "Right Alt",
  LeftAlt: "Left Alt",
  RightCtrl: "Right Ctrl",
  LeftCtrl: "Left Ctrl",
  RightShift: "Right Shift",
  LeftShift: "Left Shift",
  RightWin: "Right Win",
  LeftWin: "Left Win",
  Ctrl: "Ctrl",
  Shift: "Shift",
  Alt: "Alt",
  Win: "Win",
  Space: "Space",
  CapsLock: "Caps Lock",
  ScrollLock: "Scroll Lock",
  Mouse4: "Mouse 4 (side back)",
  Mouse5: "Mouse 5 (side forward)",
  MouseMiddle: "Middle mouse",
  MouseRight: "Right mouse",
  PageUp: "Page Up",
  PageDown: "Page Down",
  Backquote: "`",
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  Slash: "/",
  NumpadMultiply: "Numpad *",
  NumpadAdd: "Numpad +",
  NumpadSubtract: "Numpad -",
  NumpadDecimal: "Numpad .",
  NumpadDivide: "Numpad /",
};

const VK_ESCAPE = 0x1B;
const VK_LBUTTON = 0x01;

const NAME_BY_VK = new Map<number, string>(
  Object.entries(KEY_BY_NAME).map(([name, vk]) => [vk, name]),
);

for (let index = 0; index < 26; index += 1) {
  NAME_BY_VK.set(0x41 + index, String.fromCharCode(65 + index));
}
for (let index = 0; index < 10; index += 1) {
  NAME_BY_VK.set(0x30 + index, String(index));
  NAME_BY_VK.set(0x60 + index, `Numpad${index}`);
}
for (let index = 1; index <= 24; index += 1) {
  NAME_BY_VK.set(0x70 + index - 1, `F${index}`);
}

const MODIFIER_TOKEN: Record<string, (typeof MODIFIER_ORDER)[number]> = {
  ctrl: "Ctrl",
  control: "Ctrl",
  shift: "Shift",
  alt: "Alt",
  win: "Win",
  super: "Win",
};

export interface CapturedKey {
  code: string;
  keyCode: number;
}

export interface PointerModifiers {
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  win: boolean;
}

/** One key or mouse button from a finished keydown chord. `null` when the chord is not a binding. */
export function shortcutFromKeys(keys: readonly CapturedKey[]): string | null {
  const modifiers: string[] = [];
  const triggers: string[] = [];
  for (const key of keys) {
    const modifier = MODIFIER_CODE[key.code];
    if (modifier) {
      if (!modifiers.includes(modifier)) modifiers.push(modifier);
      continue;
    }
    const token = tokenFromKeyCode(key.keyCode);
    if (!token) return null;
    triggers.push(token);
  }
  if (triggers.length > 1) return null;
  if (triggers.length === 1) {
    const trigger = triggers[0];
    return trigger ? joinShortcut(modifiers, trigger) : null;
  }
  if (keys.length !== 1) return null;
  const only = keys[0];
  return only ? LONE_MODIFIER_CODE[only.code] ?? null : null;
}

/** Middle, right, and side buttons. Left click stays free so the recorder can be cancelled. */
export function mouseButtonToken(button: number): string | null {
  switch (button) {
    case 1: return "MouseMiddle";
    case 2: return "MouseRight";
    case 3: return "Mouse4";
    case 4: return "Mouse5";
    default: return null;
  }
}

export function shortcutFromMouse(button: number, modifiers: PointerModifiers): string | null {
  const token = mouseButtonToken(button);
  if (!token) return null;
  const held: string[] = [];
  if (modifiers.ctrl) held.push("Ctrl");
  if (modifiers.shift) held.push("Shift");
  if (modifiers.alt) held.push("Alt");
  if (modifiers.win) held.push("Win");
  return joinShortcut(held, token);
}

/** Canonical form, or `null` when Rust would reject the shortcut. */
export function canonicalShortcut(text: string): string | null {
  const parts = text.split("+").map((part) => part.trim()).filter(Boolean);
  const key = parts.at(-1);
  if (!key) return null;
  const token = canonicalKey(key);
  if (!token) return null;
  const modifiers: string[] = [];
  for (const name of parts.slice(0, -1)) {
    const modifier = MODIFIER_TOKEN[name.toLowerCase()];
    if (!modifier || modifiers.includes(modifier)) return null;
    modifiers.push(modifier);
  }
  return joinShortcut(modifiers, token);
}

export function hotkeyLabel(shortcut: string): string {
  if (!shortcut) return "None";
  return shortcut.split("+").map((part) => KEY_LABELS[part] ?? (/^VK(\d+)$/.test(part) ? `Key ${part.slice(2)}` : part)).join(" + ");
}

export function hotkeyListLabel(shortcuts: readonly string[]): string {
  return shortcuts.map(hotkeyLabel).join(" or ");
}

function joinShortcut(modifiers: readonly string[], key: string): string {
  const ordered = [...modifiers].sort((left, right) => MODIFIER_ORDER.indexOf(left as typeof MODIFIER_ORDER[number]) - MODIFIER_ORDER.indexOf(right as typeof MODIFIER_ORDER[number]));
  return [...ordered, key].join("+");
}

function canonicalKey(name: string): string | null {
  const lower = name.toLowerCase();
  if (lower === "escape" || lower === "esc") return null;
  if (NAME_ALIASES[lower]) return NAME_ALIASES[lower];
  const named = Object.keys(KEY_BY_NAME).find((key) => key.toLowerCase() === lower);
  if (named) return named;
  const fn = /^f(\d{1,2})$/.exec(lower);
  if (fn) {
    const index = Number(fn[1]);
    return index >= 1 && index <= 24 ? `F${index}` : null;
  }
  const numpad = /^numpad([0-9])$/.exec(lower);
  if (numpad) return `Numpad${numpad[1]}`;
  if (/^[a-z]$/.test(lower)) return lower.toUpperCase();
  if (/^[0-9]$/.test(lower)) return lower;
  const vk = /^vk(\d+)$/.exec(lower);
  if (!vk) return null;
  return tokenFromKeyCode(Number(vk[1]));
}

function tokenFromKeyCode(keyCode: number): string | null {
  if (!Number.isInteger(keyCode) || keyCode <= VK_LBUTTON || keyCode >= 255 || keyCode === VK_ESCAPE) return null;
  return NAME_BY_VK.get(keyCode) ?? `VK${keyCode}`;
}
