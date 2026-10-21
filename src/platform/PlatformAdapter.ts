import type { ClipboardChange } from "@/clipboard/clipboardEntry";
import type { ContextItem } from "@/context/ContextItem";
import type { OverlayAction, OverlaySnapshot } from "@/overlay/overlay";
import type { CameraCapture } from "@/platform/camera/CameraCapture";
import type { AudioCapture, CaptureOptions } from "@/voice/audio/AudioCapture";
import type { TargetApp } from "@/platform/targetApp";
import type { PushToTalkEvent } from "@/platform/pushToTalkEvent";
import type { LongPressBinding } from "@/settings/hotkeyChord";

export type { PushToTalkEvent } from "@/platform/pushToTalkEvent";

export interface HotkeyBindings {
  dictate: readonly string[];
  /** Delayed mouse holds that preserve a normal quick click. */
  dictateLongPress: readonly LongPressBinding[];
  note: readonly string[];
  handoff: readonly string[];
  selection: readonly string[];
  /** Press toggles Assistant. Windows only. Never starts dictation. */
  assistant: readonly string[];
  /** Press opens clipboard history. Windows only. */
  clipboard: readonly string[];
}

/** When false, Settings stays hidden so the previous app keeps focus. */
export interface CaptureSelectionOptions {
  restoreSettings?: boolean;
  /**
   * Leave the captured text on the system clipboard instead of restoring what was there.
   * Windows does this inside the capture. Other platforms still return the text for the caller to copy.
   */
  leaveOnClipboard?: boolean;
}

/** Starts the OS clipboard listener. The handler is not called for changes Personal Voice just wrote. */
export interface ClipboardWatchOptions {
  images: boolean;
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

/**
 * The platform could not type into a field because none was focused, so it put the
 * text on the clipboard instead. Dictation counts that as delivered; callers that
 * promised an actual insertion can still treat it as a failure.
 */
export class ClipboardFallbackError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClipboardFallbackError";
  }
}

/** Matches the `devices.platform` check constraint. */
export type PlatformName = "windows" | "android";
export type DictationCue = "ready" | "done";

/**
 * OS-specific behavior. Native implementations live in Rust (Windows) and the
 * Tauri Kotlin plugin (Android). Capture produces the same 16 kHz PCM16 chunks on
 * both: shared Web Audio on Windows, native `AudioRecord` on Android, where the
 * WebView can't open the microphone while the app is hidden behind the floating mic.
 */
export interface PlatformAdapter {
  readonly platform: PlatformName;
  /** A fresh capture per utterance. Assistant passes `purpose: "assistant"` so Android can use voice communication. */
  createCapture(options?: CaptureOptions): AudioCapture;
  /**
   * Device camera for Assistant photo / Camera Context. Separate from microphone capture and screen snapshots.
   * One long-lived instance per platform adapter; start/stop release hardware.
   */
  createCamera(): CameraCapture;
  /**
   * Inserts into whatever field is focused when this is called. Returns that app when it can be named.
   * Throws `ClipboardFallbackError` when no field was focused and the text went to the clipboard.
   */
  insertText(text: string): Promise<TargetApp | null>;
  /**
   * Best-effort temporary transcript in the currently focused plain-text field.
   * The platform owns the edit span and never changes rich editors it cannot verify.
   * `update` replaces the provisional text, `commit` replaces it with the corrected
   * final text, and `cancel` removes it. Returns false when inline preview is
   * unavailable or no longer safe; normal one-shot insertion remains the fallback.
   */
  liveDictationText(phase: "update" | "commit" | "cancel", text: string): Promise<boolean>;
  /** Hides Settings, restores the previous app, then inserts a received handoff. */
  insertReceivedText(text: string): Promise<TargetApp | null>;
  /** Hides Settings, reads the highlighted text in the previous app, then returns here. */
  captureSelection(options?: CaptureSelectionOptions): Promise<ContextItem>;
  /**
   * Watches the OS clipboard for changes. Windows uses a clipboard-format listener, not a poll.
   * Android resolves a no-op until the platform can observe clipboard changes in the background.
   */
  watchClipboard(options: ClipboardWatchOptions, handler: (change: ClipboardChange) => void): Promise<() => void>;
  /** Puts text on the system clipboard. Does not paste it into the focused app. */
  writeClipboardText(text: string): Promise<void>;
  /** Puts a BMP image on the system clipboard. Windows only. */
  writeClipboardImage(bmpBase64: string): Promise<void>;
  /** One explicit screenshot. Windows prefers the active window. Android uses the screen consent dialog. */
  captureSnapshot(): Promise<unknown>;
  /** Active window and top-level window titles. Windows only. */
  describeWindows(): Promise<{ active: string | null; windows: string[] }>;
  /** Opens Notepad or Calculator. The id is an allowlist key, not a path. */
  openAllowlistedApp(id: string): Promise<string>;
  /** Presses one allowlisted shortcut into the previous app. */
  pressAllowlistedShortcut(id: string, restore?: boolean): Promise<string>;
  /** Hides Settings and returns one screenshot. The window stays hidden. */
  computerCapture(): Promise<unknown>;
  /** Clicks a 0–999 point in the foreground window. */
  computerClick(x: number, y: number, times: number): Promise<string>;
  /** Shows Settings after a supervised screen task. */
  computerRestore(): Promise<void>;
  /** Always-visible floating control: snapshot in, clicks out. */
  syncOverlay(snapshot: OverlaySnapshot): Promise<void>;
  onOverlayAction(handler: (action: OverlayAction) => void): Promise<() => void>;
  openSettings(): Promise<void>;
  setHotkeys(bindings: HotkeyBindings): Promise<void>;
  /** While recording a binding, the global hook lets that chord through to Settings. */
  setHotkeyCapture(active: boolean): Promise<void>;
  /** While active, the platform routes Escape to `cancel`. */
  setDictationActive(active: boolean): Promise<void>;
  /** Best-effort local UI feedback. It must never affect Dictation success/failure. */
  playDictationCue(kind: DictationCue): Promise<void>;
  onPushToTalk(handler: (event: PushToTalkEvent) => void): Promise<() => void>;
  onPausedChange(handler: (paused: boolean) => void): Promise<() => void>;
  /** Tray asked to show the always-on-top control. Android has no tray. */
  onShowFloatingControl(handler: () => void): Promise<() => void>;
  /** `null` when this is the latest release. */
  checkForUpdate(): Promise<AvailableUpdate | null>;
}
