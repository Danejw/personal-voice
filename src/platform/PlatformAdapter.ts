import type { ContextItem } from "@/context/ContextItem";
import type { OverlayAction, OverlaySnapshot } from "@/overlay/overlay";
import type { AudioCapture } from "@/voice/audio/AudioCapture";
import type { TargetApp } from "@/platform/targetApp";
import type { PushToTalkEvent } from "@/platform/pushToTalkEvent";

export type { PushToTalkEvent } from "@/platform/pushToTalkEvent";

export interface HotkeyBindings {
  dictate: readonly string[];
  voiceNote: readonly string[];
  handoff: readonly string[];
  selection: readonly string[];
}

/** When false, Settings stays hidden so the previous app keeps focus. */
export interface CaptureSelectionOptions {
  restoreSettings?: boolean;
}

/**
 * A newer signed release. `restart`: Windows downloads, verifies, and installs it, then the
 * installer closes and reopens the app. `download`: Android opens the APK in the browser and
 * the system package installer takes over.
 */
export interface AvailableUpdate {
  version: string;
  notes: string;
  action: "restart" | "download";
  install(): Promise<void>;
}

/** Matches the `devices.platform` check constraint. */
export type PlatformName = "windows" | "android";

/**
 * OS-specific behavior. Native implementations live in Rust (Windows) and the
 * Tauri Kotlin plugin (Android). Capture produces the same 16 kHz PCM16 chunks on
 * both: shared Web Audio on Windows, native `AudioRecord` on Android, where the
 * WebView can't open the microphone while the app is hidden behind the floating mic.
 */
export interface PlatformAdapter {
  readonly platform: PlatformName;
  /** A fresh capture per utterance. */
  createCapture(): AudioCapture;
  /** Inserts into whatever field is focused when this is called. Returns that app when it can be named. */
  insertText(text: string): Promise<TargetApp | null>;
  /** Hides Settings, restores the previous app, then inserts a received handoff. */
  insertReceivedText(text: string): Promise<TargetApp | null>;
  /** Hides Settings, reads the highlighted text in the previous app, then returns here. */
  captureSelection(options?: CaptureSelectionOptions): Promise<ContextItem>;
  /** Always-visible floating control: snapshot in, clicks out. */
  syncOverlay(snapshot: OverlaySnapshot): Promise<void>;
  onOverlayAction(handler: (action: OverlayAction) => void): Promise<() => void>;
  openSettings(): Promise<void>;
  setHotkeys(bindings: HotkeyBindings): Promise<void>;
  /** While recording a binding, the global hook lets that chord through to Settings. */
  setHotkeyCapture(active: boolean): Promise<void>;
  /** While active, the platform routes Escape to `cancel`. */
  setDictationActive(active: boolean): Promise<void>;
  onPushToTalk(handler: (event: PushToTalkEvent) => void): Promise<() => void>;
  onPausedChange(handler: (paused: boolean) => void): Promise<() => void>;
  /** Tray asked to show the always-on-top control. Android has no tray. */
  onShowFloatingControl(handler: () => void): Promise<() => void>;
  /** `null` when this is the latest release. */
  checkForUpdate(): Promise<AvailableUpdate | null>;
}
