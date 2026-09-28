import type { AudioCapture } from "@/voice/audio/AudioCapture";

export type IndicatorState =
  | { kind: "listening" }
  | { kind: "finalizing" }
  | { kind: "error"; message: string };

export type PushToTalkEvent = "press" | "release" | "cancel";

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
  /** Inserts into whatever field is focused when this is called. */
  insertText(text: string): Promise<void>;
  showIndicator(state: IndicatorState): Promise<void>;
  hideIndicator(): Promise<void>;
  setPushToTalkShortcut(shortcut: string): Promise<void>;
  /** While active, the platform routes Escape to `cancel`. */
  setDictationActive(active: boolean): Promise<void>;
  onPushToTalk(handler: (event: PushToTalkEvent) => void): Promise<() => void>;
  onPausedChange(handler: (paused: boolean) => void): Promise<() => void>;
  /** `null` when this is the latest release. */
  checkForUpdate(): Promise<AvailableUpdate | null>;
}
