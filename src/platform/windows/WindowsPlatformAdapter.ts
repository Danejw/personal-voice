import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { check } from "@tauri-apps/plugin-updater";
import { contextItemFromCapture } from "@/context/ContextItem";
import type { OverlayAction, OverlaySnapshot } from "@/overlay/overlay";
import { parseOverlayAction } from "@/overlay/overlay";
import { BrowserAudioCapture } from "@/platform/BrowserAudioCapture";
import type { CameraCapture } from "@/platform/camera/CameraCapture";
import { WebCameraCapture } from "@/platform/camera/WebCameraCapture";
import type { AvailableUpdate, CaptureSelectionOptions, HotkeyBindings, PlatformAdapter } from "@/platform/PlatformAdapter";
import { parsePushToTalk, windowsShortcutTrigger } from "@/platform/pushToTalkEvent";
import type { PushToTalkEvent } from "@/platform/pushToTalkEvent";
import { parseTargetApp } from "@/platform/targetApp";
import { loadMicrophone } from "@/settings/deviceSettings";

/** Thin IPC bridge to `src-tauri/src/commands` and `src-tauri/src/platform/windows`. */
export class WindowsPlatformAdapter implements PlatformAdapter {
  readonly platform = "windows";

  /** Reads the chosen microphone per utterance, so a new choice applies to the next press. */
  createCapture() {
    return new BrowserAudioCapture(loadMicrophone());
  }

  /** Webcam via WebView `getUserMedia`. One long-lived instance; stop releases the device. */
  createCamera(): CameraCapture {
    return new WebCameraCapture();
  }

  /** Whether Windows starts the app (hidden in the tray) when the user signs in. */
  getLaunchAtLogin() {
    return invoke<boolean>("get_launch_at_login");
  }

  setLaunchAtLogin(enabled: boolean) {
    return invoke<void>("set_launch_at_login", { enabled });
  }

  async insertText(text: string) {
    return parseTargetApp(await invoke("insert_text", { text }));
  }

  async insertReceivedText(text: string) {
    return parseTargetApp(await invoke("insert_handoff_text", { text }));
  }

  async captureSelection(options?: CaptureSelectionOptions) {
    return contextItemFromCapture(await invoke("capture_selection", {
      restoreSettings: options?.restoreSettings ?? true,
    }));
  }

  captureSnapshot() {
    return invoke("capture_snapshot");
  }

  describeWindows() {
    return invoke<{ active: string | null; windows: string[] }>("describe_windows");
  }

  openAllowlistedApp(id: string) {
    return invoke<string>("open_allowlisted_app", { id });
  }

  pressAllowlistedShortcut(id: string, restore = true) {
    return invoke<string>("press_allowlisted_shortcut", { id, restore });
  }

  computerCapture() {
    return invoke("computer_capture");
  }

  computerClick(x: number, y: number, times: number) {
    return invoke<string>("computer_click", { x, y, times });
  }

  computerRestore() {
    return invoke<void>("computer_restore");
  }

  syncOverlay(snapshot: OverlaySnapshot) {
    return invoke<void>("sync_overlay", { snapshot });
  }

  onOverlayAction(handler: (action: OverlayAction) => void) {
    return listen<unknown>("overlay-action", (event) => {
      const action = parseOverlayAction(event.payload);
      if (action) handler(action);
    });
  }

  openSettings() {
    return invoke<void>("show_settings");
  }

  setHotkeys(bindings: HotkeyBindings) {
    return invoke<void>("set_hotkeys", {
      dictate: [...bindings.dictate],
      voiceNote: [...bindings.voiceNote],
      handoff: [...bindings.handoff],
      selection: [...bindings.selection],
      assistant: [...bindings.assistant],
    });
  }

  setHotkeyCapture(active: boolean) {
    return invoke<void>("set_hotkey_capture", { active });
  }

  setDictationActive(active: boolean) {
    return invoke<void>("set_dictation_active", { active });
  }

  onPushToTalk(handler: (event: PushToTalkEvent) => void) {
    return listen<unknown>("push-to-talk", (event) => {
      const parsed = parsePushToTalk(event.payload);
      if (!parsed) return;
      handler(parsed.event === "press" ? { ...parsed, trigger: windowsShortcutTrigger(parsed.destination) } : parsed);
    });
  }

  onPausedChange(handler: (paused: boolean) => void) {
    return listen<boolean>("dictation-paused", (event) => handler(event.payload));
  }

  onShowFloatingControl(handler: () => void) {
    return listen("show-floating-control", () => handler());
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
