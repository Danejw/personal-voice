import { describe, expect, it } from "vitest";
import {
  bindDeviceSettings,
  loadAssistantAutoRun,
  loadDestination,
  loadMicrophone,
  loadShowIndicator,
  loadStoredAssistantHotkey,
  loadStoredHandoffHotkey,
  loadStoredPushToTalk,
  loadStoredVoiceNoteHotkey,
  saveAssistantAutoRun,
  saveDestination,
  saveMicrophone,
  saveShowIndicator,
  saveStoredAssistantHotkey,
  saveStoredHandoffHotkey,
  saveStoredPushToTalk,
  saveStoredVoiceNoteHotkey,
} from "@/settings/deviceSettings";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
}

describe("device settings", () => {
  it("uses the system microphone until one is chosen, and can go back to it", () => {
    const storage = memoryStorage();
    bindDeviceSettings(null, storage);
    expect(loadMicrophone(storage)).toBeNull();
    saveMicrophone("usb-mic", storage);
    expect(loadMicrophone(storage)).toBe("usb-mic");
    saveMicrophone(null, storage);
    expect(loadMicrophone(storage)).toBeNull();
  });

  it("shows the indicator unless it was turned off", () => {
    const storage = memoryStorage();
    bindDeviceSettings(null, storage);
    expect(loadShowIndicator(storage)).toBe(true);
    saveShowIndicator(false, storage);
    expect(loadShowIndicator(storage)).toBe(false);
    saveShowIndicator(true, storage);
    expect(loadShowIndicator(storage)).toBe(true);
  });

  it("keeps Windows and Android preferences on separate device ids", () => {
    const storage = memoryStorage();
    saveMicrophone("headset", storage, "windows");
    saveDestination("voice-note", storage, "windows");
    saveStoredPushToTalk(["F9"], storage, "windows");
    saveShowIndicator(false, storage, "windows");

    expect(loadMicrophone(storage, "android")).toBeNull();
    expect(loadDestination(storage, "android")).toBe("active-field");
    expect(loadStoredPushToTalk(storage, "android")).toEqual([]);
    expect(loadShowIndicator(storage, "android")).toBe(true);
    expect(loadMicrophone(storage, "windows")).toBe("headset");
    expect(loadDestination(storage, "windows")).toBe("voice-note");
  });

  it("keeps extra hotkeys on this device", () => {
    const storage = memoryStorage();
    saveStoredVoiceNoteHotkey(["Mouse4", "F9"], storage, "windows");
    saveStoredHandoffHotkey(["Mouse5"], storage, "windows");
    expect(loadStoredVoiceNoteHotkey(storage, "windows")).toEqual(["Mouse4", "F9"]);
    expect(loadStoredHandoffHotkey(storage, "windows")).toEqual(["Mouse5"]);
    expect(loadStoredVoiceNoteHotkey(storage, "android")).toEqual([]);
  });

  it("runs Assistant actions automatically until review is turned on", () => {
    const storage = memoryStorage();
    expect(loadAssistantAutoRun(storage, "windows")).toBe(true);
    saveAssistantAutoRun(false, storage, "windows");
    expect(loadAssistantAutoRun(storage, "windows")).toBe(false);
    expect(loadAssistantAutoRun(storage, "android")).toBe(true);
  });

  it("keeps the Assistant shortcut on this Windows device", () => {
    const storage = memoryStorage();
    saveStoredAssistantHotkey(["Ctrl+Alt+A"], storage, "windows");
    expect(loadStoredAssistantHotkey(storage, "windows")).toEqual(["Ctrl+Alt+A"]);
    expect(loadStoredAssistantHotkey(storage, "android")).toEqual([]);
  });

  it("persists this device's dictation destination without touching another device", () => {
    const storage = memoryStorage();
    saveDestination("send-to-device", storage, "windows");
    expect(loadDestination(storage, "windows")).toBe("send-to-device");
    expect(loadDestination(storage, "android")).toBe("active-field");
  });

  it("restores this device's bindings after the session is bound again", () => {
    const storage = memoryStorage();
    storage.setItem("settings.pushToTalk", "Mouse5");
    bindDeviceSettings("pc", storage);
    saveStoredPushToTalk(["Mouse5", "F9"], storage);
    saveStoredVoiceNoteHotkey(["Mouse4"], storage);
    saveStoredHandoffHotkey(["Ctrl+Shift+Space"], storage);

    bindDeviceSettings(null, storage);
    bindDeviceSettings("pc", storage);

    expect(loadStoredPushToTalk(storage)).toEqual(["Mouse5", "F9"]);
    expect(loadStoredVoiceNoteHotkey(storage)).toEqual(["Mouse4"]);
    expect(loadStoredHandoffHotkey(storage)).toEqual(["Ctrl+Shift+Space"]);
    expect(loadStoredPushToTalk(storage, "other-pc")).toEqual(["Mouse5"]);
    expect(loadStoredHandoffHotkey(storage, "other-pc")).toEqual([]);
  });

  it("migrates legacy unscoped keys onto the first bound device once", () => {
    const storage = memoryStorage();
    storage.setItem("settings.microphone", "legacy-mic");
    storage.setItem("settings.showIndicator", "false");
    storage.setItem("settings.pushToTalk", "RightCtrl");

    bindDeviceSettings("windows", storage);

    expect(loadMicrophone(storage, "windows")).toBe("legacy-mic");
    expect(loadShowIndicator(storage, "windows")).toBe(false);
    expect(loadStoredPushToTalk(storage, "windows")).toEqual(["RightCtrl"]);

    saveMicrophone("new-mic", storage, "windows");
    expect(loadMicrophone(storage, "windows")).toBe("new-mic");
    expect(loadMicrophone(storage, "android")).toBe("legacy-mic");
    expect(storage.getItem("settings.microphone")).toBe("legacy-mic");
  });
});
