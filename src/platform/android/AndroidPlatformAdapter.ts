import { getVersion } from "@tauri-apps/api/app";
import { NativeAudioCapture } from "@/platform/android/NativeAudioCapture";
import { callPlugin, listenPlugin } from "@/platform/android/voicePlatformPlugin";
import type { AvailableUpdate, IndicatorState, PlatformAdapter, PushToTalkEvent } from "@/platform/PlatformAdapter";
import { fetchLatestAndroidRelease } from "@/services/releaseService";
import { isNewerVersion } from "@/updates/version";

export function parsePushToTalk(payload: unknown): PushToTalkEvent | null {
  const event = typeof payload === "object" && payload !== null ? (payload as { event?: unknown }).event : undefined;
  return event === "press" || event === "release" || event === "cancel" ? event : null;
}

/**
 * Bridge to the Kotlin plugin. The floating mic is the push-to-talk trigger and the
 * indicator; insertion goes through the accessibility service.
 */
export class AndroidPlatformAdapter implements PlatformAdapter {
  readonly platform = "android";

  createCapture() {
    return new NativeAudioCapture();
  }

  insertText(text: string) {
    return callPlugin("insert_text", { text });
  }

  showIndicator(state: IndicatorState) {
    return callPlugin("set_indicator", state);
  }

  hideIndicator() {
    return callPlugin("set_indicator", { kind: "idle" });
  }

  /** There is no hardware shortcut on Android; the floating mic is the trigger. */
  setPushToTalkShortcut() {
    return Promise.resolve();
  }

  /** Cancelling is a drag on the floating mic, so there is no key to route. */
  setDictationActive() {
    return Promise.resolve();
  }

  onPushToTalk(handler: (event: PushToTalkEvent) => void) {
    return listenPlugin("pushToTalk", (payload) => {
      const event = parsePushToTalk(payload);
      if (event) handler(event);
    });
  }

  /** Android has no tray pause; turning the floating mic off is the equivalent. */
  onPausedChange() {
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
