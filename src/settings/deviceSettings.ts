import type { LongPressBinding } from "@/settings/hotkeyChord";
import type { KeyValueStorage } from "@/sync/personalCache";
import { migrateDestinationId, type TranscriptDestinationId } from "@/voice/transcript/TranscriptDestination";

/** Settings that describe this install. Never written to the account `settings` row. */
const LEGACY_MICROPHONE_KEY = "settings.microphone";
const LEGACY_INDICATOR_KEY = "settings.showIndicator";
const LEGACY_DICTATION_SOUNDS_KEY = "settings.dictationSounds";
const LEGACY_PUSH_TO_TALK_KEY = "settings.pushToTalk";
const LEGACY_PUSH_TO_TALK_LONG_PRESS_KEY = "settings.pushToTalkLongPress";
const NOTE_HOTKEY_KEY = "settings.noteHotkey";
/** Read-only compatibility with existing installs that stored the previous key. */
const LEGACY_NOTE_HOTKEY_KEY = "settings.voiceNoteHotkey";
const LEGACY_HANDOFF_HOTKEY_KEY = "settings.handoffHotkey";
const LEGACY_SELECTION_HOTKEY_KEY = "settings.selectionHotkey";
const LEGACY_ASSISTANT_HOTKEY_KEY = "settings.assistantHotkey";
const LEGACY_DESTINATION_KEY = "settings.destination";
const LEGACY_TRANSFORM_KEY = "settings.transformProfileId";

let boundDeviceId: string | null = null;

export interface DevicePreferences {
  destination: TranscriptDestinationId;
  /** Transform applied to finalized Dictation text before its destination. null means no transform. */
  transformProfileId: string | null;
  microphone: string | null;
  showIndicator: boolean;
  /** Ready/done Dictation UI sounds on this device. Defaults on. */
  dictationSounds: boolean;
  /** Recorded immediate dictate bindings. A legacy install stored one shortcut string. */
  pushToTalk: string[];
  /** Mouse buttons that become Dictation only after their hold threshold. */
  pushToTalkLongPress: LongPressBinding[];
  noteHotkey: string[];
  /**
   * Hold-to-Remote-Dictation bindings.
   * Legacy installs stored this as `handoffHotkey`; both keys are still read.
   */
  remoteDictationHotkey: string[];
  selectionHotkey: string[];
  /** Windows press-to-toggle Assistant. Empty until the user records one. */
  assistantHotkey: string[];
  /** This PC may answer another device's read-only window and screenshot requests. */
  remoteReads: boolean;
  /** Assistant may receive analytics-derived profile facts. On until turned off. */
  assistantProfile: boolean;
  /** Assistant runs confirming actions without a card. Off means review each one. */
  assistantAutoRun: boolean;
  /** Allow routine, reversible accessibility commands without per-action review. */
  assistantRoutineAutoRun: boolean;
  /** This PC may run an allowlisted action asked by another owned device. */
  remoteComputerActions: boolean;
  /**
   * Other Personal Voice devices may insert Remote Dictation into this device's active field.
   * Absence means enabled so upgrades default ON.
   */
  remoteDictation: boolean;
  /** Last Remote Dictation target chosen on this source device. Not synced account-wide. */
  remoteDictationTargetDeviceId: string | null;
  /** Install updates found at startup without asking. Off means toast + manual install. */
  autoUpdate: boolean;
}

function prefsKey(deviceId: string): string {
  return `device.prefs.${deviceId}`;
}

/** Accepts a recorded list, a legacy single shortcut, or a JSON list stored in an old string key. */
function shortcutList(value: unknown, fallback: string[]): string[] {
  if (value === undefined) return fallback;
  if (value === null) return [];
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string" && item.length > 0);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith("[")) {
      try {
        return shortcutList(JSON.parse(trimmed) as unknown, []);
      } catch {
        return [trimmed];
      }
    }
    return [trimmed];
  }
  return fallback;
}

function longPressList(value: unknown, fallback: LongPressBinding[]): LongPressBinding[] {
  if (value === undefined) return fallback;
  if (typeof value === "string") {
    try {
      return longPressList(JSON.parse(value) as unknown, fallback);
    } catch {
      return fallback;
    }
  }
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const fields = record(item);
    const shortcut = typeof fields.shortcut === "string" ? fields.shortcut.trim() : "";
    const holdMs = typeof fields.holdMs === "number" && Number.isFinite(fields.holdMs)
      ? Math.round(fields.holdMs)
      : 0;
    return shortcut && holdMs > 0 ? [{ shortcut, holdMs }] : [];
  });
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

function deviceIdOrNull(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function fromLegacy(storage: KeyValueStorage): DevicePreferences {
  const microphone = storage.getItem(LEGACY_MICROPHONE_KEY) || null;
  const destination = migrateDestinationId(storage.getItem(LEGACY_DESTINATION_KEY)) ?? "active-field";
  return {
    destination,
    transformProfileId: storage.getItem(LEGACY_TRANSFORM_KEY) || null,
    microphone,
    showIndicator: storage.getItem(LEGACY_INDICATOR_KEY) !== "false",
    dictationSounds: storage.getItem(LEGACY_DICTATION_SOUNDS_KEY) !== "false",
    pushToTalk: shortcutList(storage.getItem(LEGACY_PUSH_TO_TALK_KEY), []),
    pushToTalkLongPress: longPressList(storage.getItem(LEGACY_PUSH_TO_TALK_LONG_PRESS_KEY), []),
    noteHotkey: shortcutList(storage.getItem(NOTE_HOTKEY_KEY) ?? storage.getItem(LEGACY_NOTE_HOTKEY_KEY), []),
    remoteDictationHotkey: shortcutList(storage.getItem(LEGACY_HANDOFF_HOTKEY_KEY), []),
    selectionHotkey: shortcutList(storage.getItem(LEGACY_SELECTION_HOTKEY_KEY), []),
    assistantHotkey: shortcutList(storage.getItem(LEGACY_ASSISTANT_HOTKEY_KEY), []),
    remoteReads: false,
    assistantProfile: true,
    assistantAutoRun: true,
    assistantRoutineAutoRun: false,
    remoteComputerActions: false,
    remoteDictation: true,
    remoteDictationTargetDeviceId: null,
    autoUpdate: true,
  };
}

function parsePrefs(raw: string | null, fallback: DevicePreferences): DevicePreferences {
  if (!raw) return fallback;
  try {
    const fields = record(JSON.parse(raw));
    const destination = migrateDestinationId(fields.destination) ?? fallback.destination;
    const remoteHotkey = fields.remoteDictationHotkey !== undefined
      ? shortcutList(fields.remoteDictationHotkey, fallback.remoteDictationHotkey)
      : shortcutList(fields.handoffHotkey, fallback.remoteDictationHotkey);
    return {
      destination,
      transformProfileId: fields.transformProfileId === undefined
        ? fallback.transformProfileId
        : deviceIdOrNull(fields.transformProfileId),
      microphone: typeof fields.microphone === "string" && fields.microphone
        ? fields.microphone
        : fields.microphone === null || fields.microphone === ""
          ? null
          : fallback.microphone,
      showIndicator: typeof fields.showIndicator === "boolean" ? fields.showIndicator : fallback.showIndicator,
      dictationSounds: fields.dictationSounds !== false,
      pushToTalk: shortcutList(fields.pushToTalk, fallback.pushToTalk),
      pushToTalkLongPress: longPressList(fields.pushToTalkLongPress, fallback.pushToTalkLongPress),
      noteHotkey: shortcutList(fields.noteHotkey === undefined ? fields.voiceNoteHotkey : fields.noteHotkey, fallback.noteHotkey),
      remoteDictationHotkey: remoteHotkey,
      selectionHotkey: shortcutList(fields.selectionHotkey, fallback.selectionHotkey),
      assistantHotkey: shortcutList(fields.assistantHotkey, fallback.assistantHotkey),
      remoteReads: fields.remoteReads === true,
      assistantProfile: fields.assistantProfile !== false,
      assistantAutoRun: fields.assistantAutoRun !== false,
      assistantRoutineAutoRun: fields.assistantRoutineAutoRun === true,
      remoteComputerActions: fields.remoteComputerActions === true,
      // Absence means ON. Do not use === true.
      remoteDictation: fields.remoteDictation !== false,
      remoteDictationTargetDeviceId: fields.remoteDictationTargetDeviceId === undefined
        ? fallback.remoteDictationTargetDeviceId
        : deviceIdOrNull(fields.remoteDictationTargetDeviceId),
      autoUpdate: fields.autoUpdate !== false,
    };
  } catch {
    return fallback;
  }
}

function read(storage: KeyValueStorage, deviceId: string | null): DevicePreferences {
  const legacy = fromLegacy(storage);
  if (!deviceId) return legacy;
  const stored = storage.getItem(prefsKey(deviceId));
  if (stored !== null) return parsePrefs(stored, legacy);
  storage.setItem(prefsKey(deviceId), JSON.stringify(legacy));
  return legacy;
}

function write(storage: KeyValueStorage, deviceId: string | null, patch: Partial<DevicePreferences>): DevicePreferences {
  const next = { ...read(storage, deviceId), ...patch };
  if (deviceId) {
    storage.setItem(prefsKey(deviceId), JSON.stringify(next));
    return next;
  }
  storage.setItem(LEGACY_MICROPHONE_KEY, next.microphone ?? "");
  storage.setItem(LEGACY_INDICATOR_KEY, String(next.showIndicator));
  storage.setItem(LEGACY_DICTATION_SOUNDS_KEY, String(next.dictationSounds));
  storage.setItem(LEGACY_DESTINATION_KEY, next.destination);
  storage.setItem(LEGACY_TRANSFORM_KEY, next.transformProfileId ?? "");
  storage.setItem(LEGACY_PUSH_TO_TALK_KEY, JSON.stringify(next.pushToTalk));
  storage.setItem(LEGACY_PUSH_TO_TALK_LONG_PRESS_KEY, JSON.stringify(next.pushToTalkLongPress));
  storage.setItem(NOTE_HOTKEY_KEY, JSON.stringify(next.noteHotkey));
  storage.setItem(LEGACY_HANDOFF_HOTKEY_KEY, JSON.stringify(next.remoteDictationHotkey));
  storage.setItem(LEGACY_SELECTION_HOTKEY_KEY, JSON.stringify(next.selectionHotkey));
  storage.setItem(LEGACY_ASSISTANT_HOTKEY_KEY, JSON.stringify(next.assistantHotkey));
  return next;
}

function scope(deviceId?: string | null): string | null {
  return deviceId === undefined ? boundDeviceId : deviceId;
}

/**
 * Points later load/save calls at this account's device row. `null` is signed-out
 * install storage and is not synced to other devices.
 */
export function bindDeviceSettings(deviceId: string | null, storage: KeyValueStorage = localStorage): void {
  boundDeviceId = deviceId;
  if (deviceId) read(storage, deviceId);
}

export function loadDestination(storage: KeyValueStorage = localStorage, deviceId?: string | null): TranscriptDestinationId {
  return read(storage, scope(deviceId)).destination;
}

export function saveDestination(destination: TranscriptDestinationId, storage: KeyValueStorage = localStorage, deviceId?: string | null): void {
  write(storage, scope(deviceId), { destination });
}

export function loadTransformProfileId(storage: KeyValueStorage = localStorage, deviceId?: string | null): string | null {
  return read(storage, scope(deviceId)).transformProfileId;
}

export function saveTransformProfileId(transformProfileId: string | null, storage: KeyValueStorage = localStorage, deviceId?: string | null): void {
  write(storage, scope(deviceId), { transformProfileId });
}

/** `null` means the system default microphone. */
export function loadMicrophone(storage: KeyValueStorage = localStorage, deviceId?: string | null): string | null {
  return read(storage, scope(deviceId)).microphone;
}

export function saveMicrophone(deviceId: string | null, storage: KeyValueStorage = localStorage, preferenceDeviceId?: string | null): void {
  write(storage, scope(preferenceDeviceId), { microphone: deviceId });
}

/** The always-on-top Personal Voice control. On by default. */
export function loadShowIndicator(storage: KeyValueStorage = localStorage, deviceId?: string | null): boolean {
  return read(storage, scope(deviceId)).showIndicator;
}

export function saveShowIndicator(show: boolean, storage: KeyValueStorage = localStorage, deviceId?: string | null): void {
  write(storage, scope(deviceId), { showIndicator: show });
}

/** Ready and done UI cues. Defaults ON when the preference is absent. */
export function loadDictationSounds(storage: KeyValueStorage = localStorage, deviceId?: string | null): boolean {
  return read(storage, scope(deviceId)).dictationSounds;
}

export function saveDictationSounds(enabled: boolean, storage: KeyValueStorage = localStorage, deviceId?: string | null): void {
  write(storage, scope(deviceId), { dictationSounds: enabled });
}

export function loadStoredPushToTalk(storage: KeyValueStorage = localStorage, deviceId?: string | null): string[] {
  return read(storage, scope(deviceId)).pushToTalk;
}

export function saveStoredPushToTalk(shortcuts: readonly string[], storage: KeyValueStorage = localStorage, deviceId?: string | null): void {
  write(storage, scope(deviceId), { pushToTalk: [...shortcuts] });
}

export function loadStoredPushToTalkLongPress(storage: KeyValueStorage = localStorage, deviceId?: string | null): LongPressBinding[] {
  return read(storage, scope(deviceId)).pushToTalkLongPress;
}

export function saveStoredPushToTalkLongPress(bindings: readonly LongPressBinding[], storage: KeyValueStorage = localStorage, deviceId?: string | null): void {
  write(storage, scope(deviceId), { pushToTalkLongPress: bindings.map((binding) => ({ ...binding })) });
}

export function loadStoredNoteHotkey(storage: KeyValueStorage = localStorage, deviceId?: string | null): string[] {
  return read(storage, scope(deviceId)).noteHotkey;
}

export function saveStoredNoteHotkey(shortcuts: readonly string[], storage: KeyValueStorage = localStorage, deviceId?: string | null): void {
  write(storage, scope(deviceId), { noteHotkey: [...shortcuts] });
}

/** Legacy name kept for call sites that still say handoff; same storage as Remote Dictation. */
export function loadStoredHandoffHotkey(storage: KeyValueStorage = localStorage, deviceId?: string | null): string[] {
  return loadStoredRemoteDictationHotkey(storage, deviceId);
}

export function saveStoredHandoffHotkey(shortcuts: readonly string[], storage: KeyValueStorage = localStorage, deviceId?: string | null): void {
  saveStoredRemoteDictationHotkey(shortcuts, storage, deviceId);
}

export function loadStoredRemoteDictationHotkey(storage: KeyValueStorage = localStorage, deviceId?: string | null): string[] {
  return read(storage, scope(deviceId)).remoteDictationHotkey;
}

export function saveStoredRemoteDictationHotkey(shortcuts: readonly string[], storage: KeyValueStorage = localStorage, deviceId?: string | null): void {
  write(storage, scope(deviceId), { remoteDictationHotkey: [...shortcuts] });
}

export function loadStoredSelectionHotkey(storage: KeyValueStorage = localStorage, deviceId?: string | null): string[] {
  return read(storage, scope(deviceId)).selectionHotkey;
}

export function saveStoredSelectionHotkey(shortcuts: readonly string[], storage: KeyValueStorage = localStorage, deviceId?: string | null): void {
  write(storage, scope(deviceId), { selectionHotkey: [...shortcuts] });
}

export function loadStoredAssistantHotkey(storage: KeyValueStorage = localStorage, deviceId?: string | null): string[] {
  return read(storage, scope(deviceId)).assistantHotkey;
}

export function saveStoredAssistantHotkey(shortcuts: readonly string[], storage: KeyValueStorage = localStorage, deviceId?: string | null): void {
  write(storage, scope(deviceId), { assistantHotkey: [...shortcuts] });
}

export function loadRemoteReads(storage: KeyValueStorage = localStorage, deviceId?: string | null): boolean {
  return read(storage, scope(deviceId)).remoteReads;
}

export function saveRemoteReads(enabled: boolean, storage: KeyValueStorage = localStorage, deviceId?: string | null): void {
  write(storage, scope(deviceId), { remoteReads: enabled });
}

export function loadAssistantProfile(storage: KeyValueStorage = localStorage, deviceId?: string | null): boolean {
  return read(storage, scope(deviceId)).assistantProfile;
}

export function loadAssistantAutoRun(storage: KeyValueStorage = localStorage, deviceId?: string | null): boolean {
  return read(storage, scope(deviceId)).assistantAutoRun;
}

export function saveAssistantAutoRun(enabled: boolean, storage: KeyValueStorage = localStorage, deviceId?: string | null): void {
  write(storage, scope(deviceId), { assistantAutoRun: enabled });
}

export function saveAssistantProfile(enabled: boolean, storage: KeyValueStorage = localStorage, deviceId?: string | null): void {
  write(storage, scope(deviceId), { assistantProfile: enabled });
}

export function loadRemoteComputerActions(storage: KeyValueStorage = localStorage, deviceId?: string | null): boolean {
  return read(storage, scope(deviceId)).remoteComputerActions;
}

export function saveRemoteComputerActions(enabled: boolean, storage: KeyValueStorage = localStorage, deviceId?: string | null): void {
  write(storage, scope(deviceId), { remoteComputerActions: enabled });
}

/** Allow Remote Dictation into this device. Defaults ON when the field is absent. */
export function loadRemoteDictation(storage: KeyValueStorage = localStorage, deviceId?: string | null): boolean {
  return read(storage, scope(deviceId)).remoteDictation;
}

export function saveRemoteDictation(enabled: boolean, storage: KeyValueStorage = localStorage, deviceId?: string | null): void {
  write(storage, scope(deviceId), { remoteDictation: enabled });
}

export function loadRemoteDictationTargetDeviceId(storage: KeyValueStorage = localStorage, deviceId?: string | null): string | null {
  return read(storage, scope(deviceId)).remoteDictationTargetDeviceId;
}

export function saveRemoteDictationTargetDeviceId(
  targetDeviceId: string | null,
  storage: KeyValueStorage = localStorage,
  deviceId?: string | null,
): void {
  write(storage, scope(deviceId), { remoteDictationTargetDeviceId: targetDeviceId });
}

/** Install updates found at startup without asking. On by default. */
export function loadAutoUpdate(storage: KeyValueStorage = localStorage, deviceId?: string | null): boolean {
  return read(storage, scope(deviceId)).autoUpdate;
}

export function saveAutoUpdate(enabled: boolean, storage: KeyValueStorage = localStorage, deviceId?: string | null): void {
  write(storage, scope(deviceId), { autoUpdate: enabled });
}

export function loadAssistantRoutineAutoRun(storage: KeyValueStorage = localStorage, deviceId?: string | null): boolean {
  return read(storage, scope(deviceId)).assistantRoutineAutoRun;
}
export function saveAssistantRoutineAutoRun(enabled: boolean, storage: KeyValueStorage = localStorage, deviceId?: string | null): void {
  write(storage, scope(deviceId), { assistantRoutineAutoRun: enabled });
}
