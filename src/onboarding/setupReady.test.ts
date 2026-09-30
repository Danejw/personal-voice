import { describe, expect, it } from "vitest";
import type { AndroidSetupStatus } from "@/platform/android/androidSetup";
import {
  dismissOnboarding,
  firstIncompleteStep,
  isDeviceReady,
  nextStepIndex,
  onboardingDismissed,
  setupSteps,
  stepDone,
  stepIndex,
  type DeviceReadiness,
} from "@/onboarding/setupReady";

const androidStatus = (partial: Partial<AndroidSetupStatus> = {}): AndroidSetupStatus => ({
  microphone: false,
  notifications: false,
  overlay: false,
  accessibility: false,
  floatingMic: false,
  startOnBoot: true,
  wantFloatingMic: false,
  batteryUnrestricted: false,
  ...partial,
});

function android(partial: Partial<AndroidSetupStatus> = {}, known = true): DeviceReadiness {
  return {
    platform: "android",
    known,
    microphoneGranted: false,
    floatingControl: false,
    android: androidStatus(partial),
  };
}

function windows(partial: Partial<DeviceReadiness> = {}): DeviceReadiness {
  return {
    platform: "windows",
    known: true,
    microphoneGranted: false,
    floatingControl: true,
    android: null,
    ...partial,
  };
}

describe("device readiness", () => {
  it("treats an unread status as not ready", () => {
    expect(isDeviceReady(android({}, false))).toBe(false);
    expect(isDeviceReady(windows({ known: false, microphoneGranted: true }))).toBe(false);
  });

  it("is ready on Android when the microphone, overlay, and floating mic are on", () => {
    expect(isDeviceReady(android({ microphone: true, overlay: true }))).toBe(false);
    expect(isDeviceReady(android({ microphone: true, overlay: true, floatingMic: true }))).toBe(true);
  });

  it("does not require Android accessibility, notifications, or battery", () => {
    const ready = android({
      microphone: true,
      overlay: true,
      floatingMic: true,
      accessibility: false,
      notifications: false,
      batteryUnrestricted: false,
    });
    expect(isDeviceReady(ready)).toBe(true);
    expect(stepDone("accessibility", ready)).toBe(false);
    expect(stepDone("keep-available", ready)).toBe(false);
  });

  it("is ready on Windows when the microphone is granted and the floating control is shown", () => {
    expect(isDeviceReady(windows())).toBe(false);
    expect(isDeviceReady(windows({ microphoneGranted: true, floatingControl: false }))).toBe(false);
    expect(isDeviceReady(windows({ microphoneGranted: true }))).toBe(true);
  });
});

describe("onboarding steps", () => {
  it("lists Android recommendations and leaves them off Windows", () => {
    expect(setupSteps("android").map((step) => step.id)).toEqual([
      "welcome", "microphone", "overlay", "accessibility", "keep-available", "floating", "dictation-sync", "ready",
    ]);
    expect(setupSteps("android").find((step) => step.id === "accessibility")?.optional).toBe(true);
    expect(setupSteps("android").find((step) => step.id === "keep-available")?.optional).toBe(true);
    expect(setupSteps("android").find((step) => step.id === "dictation-sync")?.optional).toBe(true);
    expect(setupSteps("windows").map((step) => step.id)).toEqual([
      "welcome", "microphone", "floating", "dictation-sync", "ready",
    ]);
    expect(setupSteps("windows").find((step) => step.id === "dictation-sync")?.optional).toBe(true);
  });

  it("opens on Welcome until a permission has actually been granted", () => {
    expect(firstIncompleteStep(android())).toBe("welcome");
    expect(firstIncompleteStep(windows())).toBe("welcome");
    expect(firstIncompleteStep(android({ microphone: true }))).toBe("overlay");
  });

  it("lands on the first unfinished recommendation before the floating mic", () => {
    expect(firstIncompleteStep(android({ microphone: true, overlay: true }))).toBe("accessibility");
    expect(firstIncompleteStep(android({
      microphone: true,
      overlay: true,
      accessibility: true,
      notifications: true,
      batteryUnrestricted: true,
    }))).toBe("floating");
  });

  it("skips the Windows floating step when the control is already shown", () => {
    const granted = windows({ microphoneGranted: true, floatingControl: true });
    expect(nextStepIndex(stepIndex("microphone", "windows"), granted)).toBe(stepIndex("dictation-sync", "windows"));
    expect(nextStepIndex(stepIndex("welcome", "windows"), windows())).toBe(stepIndex("microphone", "windows"));
  });

  it("remembers Set up later only in the storage it is given", () => {
    const storage = {
      value: null as string | null,
      getItem: () => storage.value,
      setItem: (_key: string, value: string) => { storage.value = value; },
    };
    expect(onboardingDismissed(storage)).toBe(false);
    dismissOnboarding(storage);
    expect(onboardingDismissed(storage)).toBe(true);
  });
});
