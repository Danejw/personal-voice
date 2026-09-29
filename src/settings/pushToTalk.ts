import { canonicalShortcut, hotkeyLabel } from "@/settings/hotkeyChord";
import {
  loadStoredHandoffHotkey,
  loadStoredPushToTalk,
  loadStoredSelectionHotkey,
  loadStoredVoiceNoteHotkey,
  saveStoredHandoffHotkey,
  saveStoredPushToTalk,
  saveStoredSelectionHotkey,
  saveStoredVoiceNoteHotkey,
} from "@/settings/deviceSettings";

export { hotkeyLabel } from "@/settings/hotkeyChord";

export const DEFAULT_PUSH_TO_TALK = "RightAlt";

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

export function loadVoiceNoteHotkey(): string[] {
  return keepValid(loadStoredVoiceNoteHotkey(), []);
}

export function saveVoiceNoteHotkey(shortcuts: readonly string[]): void {
  saveStoredVoiceNoteHotkey([...shortcuts]);
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

export function pushToTalkLabel(shortcut: string): string {
  return hotkeyLabel(shortcut);
}

/** True when the same key or mouse button is bound to more than one action, or twice on one action. */
export function hotkeysConflict(
  dictate: readonly string[],
  voiceNote: readonly string[],
  handoff: readonly string[],
  selection: readonly string[] = [],
): boolean {
  const bound = [dictate, voiceNote, handoff, selection]
    .flat()
    .map((shortcut) => canonicalShortcut(shortcut))
    .filter((shortcut): shortcut is string => shortcut !== null);
  return new Set(bound).size !== bound.length;
}
