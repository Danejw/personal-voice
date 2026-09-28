import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { check } from "@tauri-apps/plugin-updater";
import { BrowserAudioCapture } from "@/platform/BrowserAudioCapture";
import type { AvailableUpdate, IndicatorState, PlatformAdapter, PushToTalkEvent } from "@/platform/PlatformAdapter";

/** Thin IPC bridge to `src-tauri/src/commands` and `src-tauri/src/platform/windows`. */
export class WindowsPlatformAdapter implements PlatformAdapter {
  readonly platform = "windows";

  createCapture() {
    return new BrowserAudioCapture();
  }

  insertText(text: string) {
    return invoke<void>("insert_text", { text });
  }

  showIndicator(state: IndicatorState) {
    return invoke<void>("show_indicator", { state });
  }

  hideIndicator() {
    return invoke<void>("hide_indicator");
  }

  setPushToTalkShortcut(shortcut: string) {
    return invoke<void>("set_push_to_talk_shortcut", { shortcut });
  }

  setDictationActive(active: boolean) {
    return invoke<void>("set_dictation_active", { active });
  }

  onPushToTalk(handler: (event: PushToTalkEvent) => void) {
    return listen<PushToTalkEvent>("push-to-talk", (event) => handler(event.payload));
  }

  onPausedChange(handler: (paused: boolean) => void) {
    return listen<boolean>("dictation-paused", (event) => handler(event.payload));
  }

  /** Tauri's updater: `latest.json` from GitHub Releases, verified against `plugins.updater.pubkey`. */
  async checkForUpdate(): Promise<AvailableUpdate | null> {
    const update = await check();
    if (!update) return null;
    return {
      version: update.version,
      notes: update.body?.trim() ?? "",
      action: "restart",
      install: () => update.downloadAndInstall(),
    };
  }
}
