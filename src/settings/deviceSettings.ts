import type { KeyValueStorage } from "@/sync/personalCache";

/** Settings that describe this computer or phone, so they stay local and are never synced. */
const MICROPHONE_KEY = "settings.microphone";
const SHOW_INDICATOR_KEY = "settings.showIndicator";

/** `null` means the system default microphone. */
export function loadMicrophone(storage: KeyValueStorage = localStorage): string | null {
  return storage.getItem(MICROPHONE_KEY) || null;
}

export function saveMicrophone(deviceId: string | null, storage: KeyValueStorage = localStorage): void {
  storage.setItem(MICROPHONE_KEY, deviceId ?? "");
}

/** The Listening/Transcribing pill; errors show regardless. On by default. */
export function loadShowIndicator(storage: KeyValueStorage = localStorage): boolean {
  return storage.getItem(SHOW_INDICATOR_KEY) !== "false";
}

export function saveShowIndicator(show: boolean, storage: KeyValueStorage = localStorage): void {
  storage.setItem(SHOW_INDICATOR_KEY, String(show));
}
