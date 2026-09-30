import type { AndroidSetupStatus } from "@/platform/android/androidSetup";
import type { PlatformName } from "@/platform/PlatformAdapter";

/** One screen in the device setup flow. */
export type SetupStepId =
  | "welcome"
  | "microphone"
  | "overlay"
  | "accessibility"
  | "keep-available"
  | "floating"
  | "ready";

export interface SetupStep {
  id: SetupStepId;
  /** Recommended steps can be skipped. They do not decide whether the device is ready. */
  optional: boolean;
}

/** Live permission and floating-control state for this install. */
export interface DeviceReadiness {
  platform: PlatformName;
  /** False until the platform status has been read at least once. */
  known: boolean;
  /** Windows microphone permission. Android uses `android.microphone`. */
  microphoneGranted: boolean;
  /** Windows "Show floating control". Android uses `android.floatingMic`. */
  floatingControl: boolean;
  android: AndroidSetupStatus | null;
}

export const ONBOARDING_DISMISS_KEY = "onboarding.dismissed";

interface DismissStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Hides onboarding for this launch. The next launch shows it again if the device is still not ready. */
export function dismissOnboarding(storage: DismissStorage): void {
  storage.setItem(ONBOARDING_DISMISS_KEY, "1");
}

export function onboardingDismissed(storage: Pick<DismissStorage, "getItem">): boolean {
  return storage.getItem(ONBOARDING_DISMISS_KEY) === "1";
}

/** The floating control is on and the permissions it needs are granted. */
export function isDeviceReady(status: DeviceReadiness): boolean {
  if (!status.known) return false;
  switch (status.platform) {
    case "android": {
      const android = status.android;
      return !!android && android.microphone && android.overlay && android.floatingMic;
    }
    case "windows":
      return status.microphoneGranted && status.floatingControl;
    default: {
      const unhandled: never = status.platform;
      throw new Error(`Unhandled platform: ${String(unhandled)}`);
    }
  }
}

/** Ordered screens. Windows has no overlay permission; its floating window is a normal window. */
export function setupSteps(platform: PlatformName): SetupStep[] {
  const welcome: SetupStep = { id: "welcome", optional: false };
  const microphone: SetupStep = { id: "microphone", optional: false };
  const floating: SetupStep = { id: "floating", optional: false };
  const ready: SetupStep = { id: "ready", optional: false };
  switch (platform) {
    case "android":
      return [
        welcome,
        microphone,
        { id: "overlay", optional: false },
        { id: "accessibility", optional: true },
        { id: "keep-available", optional: true },
        floating,
        ready,
      ];
    case "windows":
      return [welcome, microphone, floating, ready];
    default: {
      const unhandled: never = platform;
      throw new Error(`Unhandled platform: ${String(unhandled)}`);
    }
  }
}

export function stepIndex(id: SetupStepId, platform: PlatformName): number {
  const index = setupSteps(platform).findIndex((step) => step.id === id);
  if (index < 0) throw new Error(`Missing setup step: ${id}`);
  return index;
}

/** True when this screen's requirement is already satisfied. Welcome and Ready are never skipped that way. */
export function stepDone(id: SetupStepId, status: DeviceReadiness): boolean {
  switch (id) {
    case "welcome":
    case "ready":
      return false;
    case "microphone":
      return status.platform === "android" ? status.android?.microphone === true : status.microphoneGranted;
    case "overlay":
      return status.android?.overlay === true;
    case "accessibility":
      return status.android?.accessibility === true;
    case "keep-available":
      return status.android?.notifications === true && status.android?.batteryUnrestricted === true;
    case "floating":
      return status.platform === "android" ? status.android?.floatingMic === true : status.floatingControl;
    default: {
      const unhandled: never = id;
      throw new Error(`Unhandled setup step: ${String(unhandled)}`);
    }
  }
}

/**
 * Where a returning visit should open. Welcome is skipped once any real permission is already
 * granted. The Windows floating control defaults on, so that alone does not skip Welcome.
 */
export function firstIncompleteStep(status: DeviceReadiness): SetupStepId {
  const steps = setupSteps(status.platform);
  const progressed = hasSetupProgress(status);
  for (const step of steps) {
    if (step.id === "welcome" && progressed) continue;
    if (step.id === "ready") return "ready";
    if (!stepDone(step.id, status)) return step.id;
  }
  return "ready";
}

/** Next screen after `from`, skipping steps that are already done. Ready is never skipped. */
export function nextStepIndex(from: number, status: DeviceReadiness): number {
  const steps = setupSteps(status.platform);
  for (let index = from + 1; index < steps.length; index += 1) {
    const step = steps[index];
    if (!step) break;
    if (step.id === "ready" || !stepDone(step.id, status)) return index;
  }
  return Math.max(0, steps.length - 1);
}

function hasSetupProgress(status: DeviceReadiness): boolean {
  switch (status.platform) {
    case "android": {
      const android = status.android;
      if (!android) return false;
      return android.microphone || android.overlay || android.floatingMic
        || android.accessibility || android.notifications || android.batteryUnrestricted;
    }
    case "windows":
      return status.microphoneGranted;
    default: {
      const unhandled: never = status.platform;
      throw new Error(`Unhandled platform: ${String(unhandled)}`);
    }
  }
}
