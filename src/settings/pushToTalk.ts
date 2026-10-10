import { canonicalShortcut, hotkeyLabel, isMouseShortcut, type LongPressBinding } from "@/settings/hotkeyChord";
import {
  loadStoredAssistantHotkey,
  loadStoredHandoffHotkey,
  loadStoredPushToTalk,
  loadStoredPushToTalkLongPress,
  loadStoredSelectionHotkey,
  loadStoredNoteHotkey,
  saveStoredAssistantHotkey,
  saveStoredHandoffHotkey,
  saveStoredPushToTalk,
  saveStoredPushToTalkLongPress,
  saveStoredSelectionHotkey,
  saveStoredNoteHotkey,
} from "@/settings/deviceSettings";

export { hotkeyLabel } from "@/settings/hotkeyChord";

export const DEFAULT_PUSH_TO_TALK = "RightAlt";
export const DEFAULT_LONG_PRESS_MS = 500;
export const LONG_PRESS_MS_OPTIONS = [300, 500, 750, 1000] as const;

/** Enough for a mouse button and a few keyboard chords on one action. */
export const MAX_BINDINGS_PER_ACTION = 8;

function keepValid(values: readonly string[], fallback: readonly string[]): string[] {
  const valid = values
    .map((value) => canonicalShortcut(value))
    .filter((value): value is string => value !== null);
  const unique = [...new Set(valid)];
  return unique.length > 0 || fallback.length === 0 ? unique : [...fallback];
}

export function loadPushToTalk(): string[] {
  return keepValid(loadStoredPushToTalk(), [DEFAULT_PUSH_TO_TALK]);
}

export function savePushToTalk(shortcuts: readonly string[]): void {
  saveStoredPushToTalk([...shortcuts]);
}

export function loadPushToTalkLongPress(): LongPressBinding[] {
  const seen = new Set<string>();
  return loadStoredPushToTalkLongPress().flatMap((binding) => {
    const shortcut = canonicalShortcut(binding.shortcut);
    if (!shortcut || !isMouseShortcut(shortcut) || seen.has(shortcut)) return [];
    const holdMs = LONG_PRESS_MS_OPTIONS.includes(binding.holdMs as typeof LONG_PRESS_MS_OPTIONS[number])
      ? binding.holdMs
      : DEFAULT_LONG_PRESS_MS;
    seen.add(shortcut);
    return [{ shortcut, holdMs }];
  });
}

export function savePushToTalkLongPress(bindings: readonly LongPressBinding[]): void {
  saveStoredPushToTalkLongPress(bindings);
}

export function loadNoteHotkey(): string[] {
  return keepValid(loadStoredNoteHotkey(), []);
}

export function saveNoteHotkey(shortcuts: readonly string[]): void {
  saveStoredNoteHotkey([...shortcuts]);
}

export function loadHandoffHotkey(): string[] {
  return keepValid(loadStoredHandoffHotkey(), []);
}

export function saveHandoffHotkey(shortcuts: readonly string[]): void {
  saveStoredHandoffHotkey([...shortcuts]);
}

export function loadSelectionHotkey(): string[] {
  return keepValid(loadStoredSelectionHotkey(), []);
}

export function saveSelectionHotkey(shortcuts: readonly string[]): void {
  saveStoredSelectionHotkey([...shortcuts]);
}

export function loadAssistantHotkey(): string[] {
  return keepValid(loadStoredAssistantHotkey(), []);
}

export function saveAssistantHotkey(shortcuts: readonly string[]): void {
  saveStoredAssistantHotkey([...shortcuts]);
}

export function pushToTalkLabel(shortcut: string): string {
  return hotkeyLabel(shortcut);
}

/** True when the same key or mouse button is bound to more than one action, or twice on one action. */
export function hotkeysConflict(...lists: readonly (readonly string[])[]): boolean {
  const bound = lists
    .flat()
    .map((shortcut) => canonicalShortcut(shortcut))
    .filter((shortcut): shortcut is string => shortcut !== null);
  return new Set(bound).size !== bound.length;
}
