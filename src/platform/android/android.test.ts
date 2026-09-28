import { describe, expect, it } from "vitest";
import { parsePushToTalk } from "@/platform/android/AndroidPlatformAdapter";
import { canStartFloatingMic, parseSetupStatus } from "@/platform/android/androidSetup";
import { pluginErrorMessage } from "@/platform/android/voicePlatformPlugin";

describe("Android floating mic events", () => {
  it("accepts the three push-to-talk events and ignores anything else", () => {
    expect(parsePushToTalk({ event: "press" })).toBe("press");
    expect(parsePushToTalk({ event: "release" })).toBe("release");
    expect(parsePushToTalk({ event: "cancel" })).toBe("cancel");
    expect(parsePushToTalk({ event: "tap" })).toBeNull();
    expect(parsePushToTalk(null)).toBeNull();
  });
});

describe("Android setup status", () => {
  it("treats missing or malformed fields as not granted", () => {
    expect(parseSetupStatus({ microphone: true, overlay: "yes" })).toEqual({
      microphone: true, notifications: false, overlay: false, accessibility: false, floatingMic: false,
    });
  });

  it("needs microphone and overlay; accessibility and notifications are optional", () => {
    const ready = { microphone: true, overlay: true, notifications: false, accessibility: false, floatingMic: false };
    expect(canStartFloatingMic(ready)).toBe(true);
    expect(canStartFloatingMic({ ...ready, overlay: false })).toBe(false);
    expect(canStartFloatingMic({ ...ready, microphone: false })).toBe(false);
  });
});

describe("pluginErrorMessage", () => {
  it("unwraps Kotlin rejections so the user sees their message", () => {
    expect(pluginErrorMessage({ message: "Dictation doesn't type into password fields." }))
      .toBe("Dictation doesn't type into password fields.");
    expect(pluginErrorMessage("Plugin voice-platform not initialized")).toBe("Plugin voice-platform not initialized");
    expect(pluginErrorMessage({})).toBe("The Android platform call failed.");
  });
});
