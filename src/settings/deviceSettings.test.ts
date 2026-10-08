import { describe, expect, it } from "vitest";
import {
  bindDeviceSettings,
  loadAssistantAutoRun,
  loadAssistantRoutineAutoRun,
  loadAutoUpdate,
  loadDestination,
  loadDictationSounds,
  loadMicrophone,
  loadRemoteComputerActions,
  loadRemoteDictation,
  loadShowIndicator,
  loadTransformProfileId,
  loadStoredAssistantHotkey,
  loadStoredHandoffHotkey,
  loadStoredPushToTalk,
  loadStoredPushToTalkLongPress,
  loadStoredRemoteDictationHotkey,
  loadStoredVoiceNoteHotkey,
  saveAssistantAutoRun,
  saveAssistantRoutineAutoRun,
  saveAutoUpdate,
  saveDestination,
  saveDictationSounds,
  saveMicrophone,
  saveRemoteDictation,
  saveShowIndicator,
  saveTransformProfileId,
  saveStoredAssistantHotkey,
  saveStoredHandoffHotkey,
  saveStoredPushToTalk,
  saveStoredPushToTalkLongPress,
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

  it("plays Dictation sounds by default and keeps the choice per device", () => {
    const storage = memoryStorage();
    expect(loadDictationSounds(storage, "windows")).toBe(true);
    expect(loadDictationSounds(storage, "android")).toBe(true);

    saveDictationSounds(false, storage, "windows");
    expect(loadDictationSounds(storage, "windows")).toBe(false);
    expect(loadDictationSounds(storage, "android")).toBe(true);

    saveDictationSounds(true, storage, "windows");
    expect(loadDictationSounds(storage, "windows")).toBe(true);
  });

  it("keeps routine accessibility auto-run off until explicitly enabled per device", () => {
    const storage=memoryStorage();
    expect(loadAssistantRoutineAutoRun(storage,"windows")).toBe(false);
    saveAssistantRoutineAutoRun(true,storage,"windows");
    expect(loadAssistantRoutineAutoRun(storage,"windows")).toBe(true);
    expect(loadAssistantRoutineAutoRun(storage,"android")).toBe(false);
    saveAssistantRoutineAutoRun(false,storage,"windows");
    expect(loadAssistantRoutineAutoRun(storage,"windows")).toBe(false);
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

  it("keeps multiple Dictation bindings on the same device", () => {
    const storage = memoryStorage();
    saveStoredPushToTalk(["RightAlt", "MouseRight"], storage, "windows");
    expect(loadStoredPushToTalk(storage, "windows")).toEqual(["RightAlt", "MouseRight"]);
  });

  it("keeps delayed Dictation mouse bindings and hold times on this device", () => {
    const storage = memoryStorage();
    saveStoredPushToTalkLongPress(
      [{ shortcut: "MouseRight", holdMs: 500 }, { shortcut: "Mouse4", holdMs: 750 }],
      storage,
      "windows",
    );
    expect(loadStoredPushToTalkLongPress(storage, "windows")).toEqual([
      { shortcut: "MouseRight", holdMs: 500 },
      { shortcut: "Mouse4", holdMs: 750 },
    ]);
    expect(loadStoredPushToTalkLongPress(storage, "android")).toEqual([]);
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

  it("auto-updates until turned off, per device", () => {
    const storage = memoryStorage();
    expect(loadAutoUpdate(storage, "windows")).toBe(true);
    saveAutoUpdate(false, storage, "windows");
    expect(loadAutoUpdate(storage, "windows")).toBe(false);
    expect(loadAutoUpdate(storage, "android")).toBe(true);
  });

  it("keeps the Assistant shortcut on this Windows device", () => {
    const storage = memoryStorage();
    saveStoredAssistantHotkey(["Ctrl+Alt+A"], storage, "windows");
    expect(loadStoredAssistantHotkey(storage, "windows")).toEqual(["Ctrl+Alt+A"]);
    expect(loadStoredAssistantHotkey(storage, "android")).toEqual([]);
  });

  it("keeps the selected Dictation transform on this device", () => {
    const storage = memoryStorage();
    saveTransformProfileId("builtin:prompt-engineer", storage, "windows");
    expect(loadTransformProfileId(storage, "windows")).toBe("builtin:prompt-engineer");
    expect(loadTransformProfileId(storage, "android")).toBeNull();
    saveTransformProfileId(null, storage, "windows");
    expect(loadTransformProfileId(storage, "windows")).toBeNull();
  });

  it("persists this device's dictation destination without touching another device", () => {
    const storage = memoryStorage();
    saveDestination("remote-dictation", storage, "windows");
    expect(loadDestination(storage, "windows")).toBe("remote-dictation");
    expect(loadDestination(storage, "android")).toBe("active-field");
  });

  it("migrates legacy send-to-device destinations onto remote-dictation", () => {
    const storage = memoryStorage();
    storage.setItem("device.prefs.windows", JSON.stringify({ destination: "send-to-device" }));
    expect(loadDestination(storage, "windows")).toBe("remote-dictation");
  });

  it("defaults Allow remote dictation ON when the field is absent, and keeps explicit OFF", () => {
    const storage = memoryStorage();
    storage.setItem("device.prefs.windows", JSON.stringify({ destination: "active-field" }));
    expect(loadRemoteDictation(storage, "windows")).toBe(true);
    saveRemoteDictation(false, storage, "windows");
    expect(loadRemoteDictation(storage, "windows")).toBe(false);
    expect(loadRemoteComputerActions(storage, "windows")).toBe(false);
  });

  it("migrates legacy handoffHotkey bindings onto remoteDictationHotkey", () => {
    const storage = memoryStorage();
    storage.setItem("device.prefs.windows", JSON.stringify({ handoffHotkey: ["Mouse5"] }));
    expect(loadStoredRemoteDictationHotkey(storage, "windows")).toEqual(["Mouse5"]);
    expect(loadStoredHandoffHotkey(storage, "windows")).toEqual(["Mouse5"]);
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
