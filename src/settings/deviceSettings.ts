import type { KeyValueStorage } from "@/sync/personalCache";
import type { TranscriptDestinationId } from "@/voice/transcript/TranscriptDestination";

/** Settings that describe this install. Never written to the account `settings` row. */
const LEGACY_MICROPHONE_KEY = "settings.microphone";
const LEGACY_INDICATOR_KEY = "settings.showIndicator";
const LEGACY_PUSH_TO_TALK_KEY = "settings.pushToTalk";
const LEGACY_VOICE_NOTE_HOTKEY_KEY = "settings.voiceNoteHotkey";
const LEGACY_HANDOFF_HOTKEY_KEY = "settings.handoffHotkey";
const LEGACY_SELECTION_HOTKEY_KEY = "settings.selectionHotkey";
const LEGACY_ASSISTANT_HOTKEY_KEY = "settings.assistantHotkey";
const LEGACY_DESTINATION_KEY = "settings.destination";

let boundDeviceId: string | null = null;

export interface DevicePreferences {
  destination: TranscriptDestinationId;
  microphone: string | null;
  showIndicator: boolean;
  /** Recorded dictate bindings. A legacy install stored one shortcut string. */
  pushToTalk: string[];
  voiceNoteHotkey: string[];
  handoffHotkey: string[];
  selectionHotkey: string[];
  /** Windows press-to-toggle Assistant. Empty until the user records one. */
  assistantHotkey: string[];
  /** This PC may answer another device's read-only window and screenshot requests. */
  remoteReads: boolean;
  /** Assistant may receive analytics-derived profile facts. On until turned off. */
  assistantProfile: boolean;
  /** Assistant runs confirming actions without a card. Off means review each one. */
  assistantAutoRun: boolean;
  /** This PC may run an allowlisted action asked by another owned device. */
  remoteComputerActions: boolean;
}

function prefsKey(deviceId: string): string {
  return `device.prefs.${deviceId}`;
}

function isDestination(value: unknown): value is TranscriptDestinationId {
  return value === "active-field" || value === "voice-note" || value === "send-to-device";
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

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

function fromLegacy(storage: KeyValueStorage): DevicePreferences {
  const microphone = storage.getItem(LEGACY_MICROPHONE_KEY) || null;
  const destination = storage.getItem(LEGACY_DESTINATION_KEY);
  return {
    destination: isDestination(destination) ? destination : "active-field",
    microphone,
    showIndicator: storage.getItem(LEGACY_INDICATOR_KEY) !== "false",
    pushToTalk: shortcutList(storage.getItem(LEGACY_PUSH_TO_TALK_KEY), []),
    voiceNoteHotkey: shortcutList(storage.getItem(LEGACY_VOICE_NOTE_HOTKEY_KEY), []),
    handoffHotkey: shortcutList(storage.getItem(LEGACY_HANDOFF_HOTKEY_KEY), []),
    selectionHotkey: shortcutList(storage.getItem(LEGACY_SELECTION_HOTKEY_KEY), []),
    assistantHotkey: shortcutList(storage.getItem(LEGACY_ASSISTANT_HOTKEY_KEY), []),
    remoteReads: false,
    assistantProfile: true,
    assistantAutoRun: true,
    remoteComputerActions: false,
  };
}

function parsePrefs(raw: string | null, fallback: DevicePreferences): DevicePreferences {
  if (!raw) return fallback;
  try {
    const fields = record(JSON.parse(raw));
    return {
      destination: isDestination(fields.destination) ? fields.destination : fallback.destination,
      microphone: typeof fields.microphone === "string" && fields.microphone
        ? fields.microphone
        : fields.microphone === null || fields.microphone === ""
          ? null
          : fallback.microphone,
      showIndicator: typeof fields.showIndicator === "boolean" ? fields.showIndicator : fallback.showIndicator,
      pushToTalk: shortcutList(fields.pushToTalk, fallback.pushToTalk),
      voiceNoteHotkey: shortcutList(fields.voiceNoteHotkey, fallback.voiceNoteHotkey),
      handoffHotkey: shortcutList(fields.handoffHotkey, fallback.handoffHotkey),
      selectionHotkey: shortcutList(fields.selectionHotkey, fallback.selectionHotkey),
      assistantHotkey: shortcutList(fields.assistantHotkey, fallback.assistantHotkey),
      remoteReads: fields.remoteReads === true,
      assistantProfile: fields.assistantProfile !== false,
      assistantAutoRun: fields.assistantAutoRun !== false,
      remoteComputerActions: fields.remoteComputerActions === true,
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
  storage.setItem(LEGACY_DESTINATION_KEY, next.destination);
  storage.setItem(LEGACY_PUSH_TO_TALK_KEY, JSON.stringify(next.pushToTalk));
  storage.setItem(LEGACY_VOICE_NOTE_HOTKEY_KEY, JSON.stringify(next.voiceNoteHotkey));
  storage.setItem(LEGACY_HANDOFF_HOTKEY_KEY, JSON.stringify(next.handoffHotkey));
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

export function loadStoredPushToTalk(storage: KeyValueStorage = localStorage, deviceId?: string | null): string[] {
  return read(storage, scope(deviceId)).pushToTalk;
}

export function saveStoredPushToTalk(shortcuts: readonly string[], storage: KeyValueStorage = localStorage, deviceId?: string | null): void {
  write(storage, scope(deviceId), { pushToTalk: [...shortcuts] });
}

export function loadStoredVoiceNoteHotkey(storage: KeyValueStorage = localStorage, deviceId?: string | null): string[] {
  return read(storage, scope(deviceId)).voiceNoteHotkey;
}

export function saveStoredVoiceNoteHotkey(shortcuts: readonly string[], storage: KeyValueStorage = localStorage, deviceId?: string | null): void {
  write(storage, scope(deviceId), { voiceNoteHotkey: [...shortcuts] });
}

export function loadStoredHandoffHotkey(storage: KeyValueStorage = localStorage, deviceId?: string | null): string[] {
  return read(storage, scope(deviceId)).handoffHotkey;
}

export function saveStoredHandoffHotkey(shortcuts: readonly string[], storage: KeyValueStorage = localStorage, deviceId?: string | null): void {
  write(storage, scope(deviceId), { handoffHotkey: [...shortcuts] });
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
