import { describe, expect, it } from "vitest";
import { parsePushToTalk } from "@/platform/android/AndroidPlatformAdapter";
import { canStartFloatingMic, parseSetupStatus } from "@/platform/android/androidSetup";
import { pluginErrorMessage } from "@/platform/android/voicePlatformPlugin";

describe("Android floating mic events", () => {
  it("accepts the three push-to-talk events and ignores anything else", () => {
    expect(parsePushToTalk({ event: "press" })).toEqual({ event: "press" });
    expect(parsePushToTalk({ event: "release" })).toEqual({ event: "release" });
    expect(parsePushToTalk({ event: "cancel" })).toEqual({ event: "cancel" });
    expect(parsePushToTalk({ event: "capture-selection" })).toEqual({ event: "capture-selection" });
    expect(parsePushToTalk({ event: "tap" })).toBeNull();
    expect(parsePushToTalk(null)).toBeNull();
  });
});

describe("Android setup status", () => {
  it("treats missing or malformed fields as not granted", () => {
    expect(parseSetupStatus({ microphone: true, overlay: "yes" })).toEqual({
      microphone: true,
      notifications: false,
      overlay: false,
      accessibility: false,
      floatingMic: false,
      startOnBoot: true,
      wantFloatingMic: false,
      earbudHoldToDictate: true,
      preferHeadsetMic: true,
      headsetMicAvailable: false,
      batteryUnrestricted: false,
    });
  });

  it("defaults personal Android conveniences on when the plugin omits them", () => {
    const status = parseSetupStatus({ microphone: true, overlay: true });
    expect(status.startOnBoot).toBe(true);
    expect(status.earbudHoldToDictate).toBe(true);
    expect(status.preferHeadsetMic).toBe(true);
    expect(parseSetupStatus({ startOnBoot: false, earbudHoldToDictate: false, preferHeadsetMic: false }))
      .toMatchObject({ startOnBoot: false, earbudHoldToDictate: false, preferHeadsetMic: false });
  });

  it("parses always-on and battery fields", () => {
    expect(parseSetupStatus({
      microphone: true,
      overlay: true,
      startOnBoot: true,
      wantFloatingMic: true,
      earbudHoldToDictate: false,
      preferHeadsetMic: false,
      headsetMicAvailable: true,
      batteryUnrestricted: true,
      floatingMic: true,
    })).toMatchObject({
      startOnBoot: true,
      wantFloatingMic: true,
      earbudHoldToDictate: false,
      preferHeadsetMic: false,
      headsetMicAvailable: true,
      batteryUnrestricted: true,
      floatingMic: true,
    });
  });

  it("needs microphone and overlay; accessibility and notifications are optional", () => {
    const ready = {
      microphone: true,
      overlay: true,
      notifications: false,
      accessibility: false,
      floatingMic: false,
      startOnBoot: true,
      wantFloatingMic: false,
      earbudHoldToDictate: true,
      preferHeadsetMic: true,
      headsetMicAvailable: false,
      batteryUnrestricted: false,
    };
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
