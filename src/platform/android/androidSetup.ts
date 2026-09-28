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
  startFloatingMic: () => callPlugin("start_floating_mic"),
  stopFloatingMic: () => callPlugin("stop_floating_mic"),
  /** Fires when the service starts or stops, including from the notification's Turn off action. */
  onFloatingMicChanged: (handler: () => void) => listenPlugin("floatingMicChanged", () => handler()),
};
