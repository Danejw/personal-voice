import { getVersion } from "@tauri-apps/api/app";
import { contextItemFromCapture } from "@/context/ContextItem";
import type { OverlayAction, OverlaySnapshot } from "@/overlay/overlay";
import { parseOverlayAction } from "@/overlay/overlay";
import { NativeAudioCapture } from "@/platform/android/NativeAudioCapture";
import { callPlugin, listenPlugin } from "@/platform/android/voicePlatformPlugin";
import type { AvailableUpdate, CaptureSelectionOptions, PlatformAdapter } from "@/platform/PlatformAdapter";
import { parseTargetApp } from "@/platform/targetApp";
import { parsePushToTalk } from "@/platform/pushToTalkEvent";
import type { PushToTalkEvent } from "@/platform/pushToTalkEvent";
import { fetchLatestAndroidRelease } from "@/services/releaseService";
import { isNewerVersion } from "@/updates/version";

export { parsePushToTalk } from "@/platform/pushToTalkEvent";

/**
 * Bridge to the Kotlin plugin. The floating mic is the always-visible control,
 * hold-to-talk trigger, and overlay panel; insertion goes through accessibility.
 */
export class AndroidPlatformAdapter implements PlatformAdapter {
  readonly platform = "android";

  createCapture() {
    return new NativeAudioCapture();
  }

  async insertText(text: string) {
    return parseTargetApp(await callPlugin("insert_text", { text }));
  }

  async insertReceivedText(text: string) {
    return parseTargetApp(await callPlugin("insert_handoff_text", { text }));
  }

  async captureSelection(options?: CaptureSelectionOptions) {
    return contextItemFromCapture(await callPlugin("capture_selection", {
      restoreSettings: options?.restoreSettings ?? true,
    }));
  }

  captureSnapshot() {
    return callPlugin("capture_snapshot");
  }

  describeWindows() {
    return Promise.reject(new Error("This device can't share windows."));
  }

  openAllowlistedApp() {
    return Promise.reject(new Error("This device can't run desktop actions."));
  }

  pressAllowlistedShortcut() {
    return Promise.reject(new Error("This device can't run desktop actions."));
  }

  computerCapture() {
    return Promise.reject(new Error("This device can't run desktop actions."));
  }

  computerClick() {
    return Promise.reject(new Error("This device can't run desktop actions."));
  }

  computerRestore() {
    return Promise.resolve();
  }

  syncOverlay(snapshot: OverlaySnapshot) {
    return callPlugin("set_overlay", { snapshot: JSON.stringify(snapshot) });
  }

  onOverlayAction(handler: (action: OverlayAction) => void) {
    return listenPlugin("overlayAction", (payload) => {
      const action = parseOverlayAction(payload);
      if (action) handler(action);
    });
  }

  openSettings() {
    return callPlugin("show_settings");
  }

  /** There is no hardware shortcut on Android; the floating mic is the trigger. */
  setHotkeys() {
    return Promise.resolve();
  }

  setHotkeyCapture() {
    return Promise.resolve();
  }

  /** Cancelling is a drag on the floating mic, so there is no key to route. */
  setDictationActive() {
    return Promise.resolve();
  }

  onPushToTalk(handler: (event: PushToTalkEvent) => void) {
    return listenPlugin("pushToTalk", (payload) => {
      const event = parsePushToTalk(payload);
      if (!event) return;
      handler(event.event === "press" ? { ...event, trigger: "android-floating-mic" } : event);
    });
  }

  /** Android has no tray pause; turning the floating mic off is the equivalent. */
  onPausedChange() {
    return Promise.resolve(() => undefined);
  }

  onShowFloatingControl() {
    return Promise.resolve(() => undefined);
  }

  /**
   * Tauri's updater is desktop-only. The browser downloads the APK and Android's package
   * installer asks the user; it only accepts an update signed with the same key.
   */
  async checkForUpdate(): Promise<AvailableUpdate | null> {
    const [current, release] = await Promise.all([getVersion(), fetchLatestAndroidRelease()]);
    if (!release || !isNewerVersion(release.version, current)) return null;
    return {
      version: release.version,
      notes: release.notes,
      action: "download",
      install: () => callPlugin("open_download", { url: release.apkUrl }),
    };
  }
}
