import { callPlugin, listenPlugin } from "@/platform/android/voicePlatformPlugin";

/** What the floating mic needs, as reported by the Kotlin plugin. */
export interface AndroidSetupStatus {
  microphone: boolean;
  /** Lets the "floating mic is on" notification show. Optional, but recommended. */
  notifications: boolean;
  /** "Display over other apps". */
  overlay: boolean;
  /** The accessibility service is enabled and connected. Without it, text goes to the clipboard. */
  accessibility: boolean;
  floatingMic: boolean;
  /** Restore the floating mic after reboot when it was left on. Default on. */
  startOnBoot: boolean;
  /** User turned the floating mic on and has not turned it off. */
  wantFloatingMic: boolean;
  /** Hold a supported headset media button to run Dictation. */
  earbudHoldToDictate: boolean;
  /** Ask AudioRecord to use a connected headset microphone for Dictation. */
  preferHeadsetMic: boolean;
  /** Android currently exposes a microphone-class headset input. */
  headsetMicAvailable: boolean;
  /** Android is not battery-optimizing this app. Recommended for always-on. */
  batteryUnrestricted: boolean;
}

export type AndroidPermission = "microphone" | "notifications";

export function parseSetupStatus(value: unknown): AndroidSetupStatus {
  const fields = typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
  return {
    microphone: fields.microphone === true,
    notifications: fields.notifications === true,
    overlay: fields.overlay === true,
    accessibility: fields.accessibility === true,
    floatingMic: fields.floatingMic === true,
    // Default on in Kotlin; treat missing as on so the toggle matches first paint.
    startOnBoot: fields.startOnBoot !== false,
    wantFloatingMic: fields.wantFloatingMic === true,
    // Both personal-device conveniences default on in Kotlin.
    earbudHoldToDictate: fields.earbudHoldToDictate !== false,
    preferHeadsetMic: fields.preferHeadsetMic !== false,
    headsetMicAvailable: fields.headsetMicAvailable === true,
    batteryUnrestricted: fields.batteryUnrestricted === true,
  };
}

/** The floating mic can run without accessibility (clipboard fallback) or notifications. */
export function canStartFloatingMic(status: AndroidSetupStatus): boolean {
  return status.microphone && status.overlay;
}

export const androidSetup = {
  async status(): Promise<AndroidSetupStatus> {
    return parseSetupStatus(await callPlugin<unknown>("get_status"));
  },
  async requestPermissions(permissions: AndroidPermission[]): Promise<void> {
    await callPlugin<unknown>("request_permissions", { permissions });
  },
  openOverlaySettings: () => callPlugin("open_overlay_settings"),
  openAccessibilitySettings: () => callPlugin("open_accessibility_settings"),
  openAppSettings: () => callPlugin("open_app_settings"),
  openBatterySettings: () => callPlugin("open_battery_settings"),
  setStartOnBoot: (enabled: boolean) => callPlugin("set_start_on_boot", { enabled }),
  setEarbudHoldToDictate: (enabled: boolean) => callPlugin("set_earbud_hold_to_dictate", { enabled }),
  setPreferHeadsetMic: (enabled: boolean) => callPlugin("set_prefer_headset_mic", { enabled }),
  startFloatingMic: () => callPlugin("start_floating_mic"),
  stopFloatingMic: () => callPlugin("stop_floating_mic"),
  /** Fires when the service starts or stops, including from the notification's Turn off action. */
  onFloatingMicChanged: (handler: () => void) => listenPlugin("floatingMicChanged", () => handler()),
};
