# Phase 6 implementation report — Android system-wide dictation

## Scope

Only `prompts/06-android.md`: the same Tauri app running on Android, a floating mic over other apps, a microphone foreground service, accessibility insertion into the focused field, and the permission and setup UX. Gemini, vocabulary, settings, auth, and transcript state stay in the shared TypeScript. There's no custom keyboard, no signed release APK, and nothing from later phases.

## How it works

1. In the app's **Floating mic** section, the user grants the microphone and "display over other apps", plus optionally accessibility and notifications, then taps **Turn on floating mic**. Android only allows a microphone foreground service to start while the app is visible, so this has to happen in the app.
2. The service shows the bubble and an ongoing notification with **Turn off**.
3. In any app, holding the bubble sends `press`. The plugin wakes the WebView, and the shared `DictationController` starts native capture and the Gemini Live session exactly as on Windows.
4. Releasing finalizes. The controller calls `insertText`, and the accessibility service types into the focused field. If it can't, the text goes to the clipboard and the bubble's error toast says so.
5. Dragging the bubble moves it and cancels the utterance.

Design details and deviations are in `docs/ANDROID.md` under "As implemented (Phase 6)".

## Deviations from the prompt/docs

- **Inlined plugin instead of a separate plugin crate.** It's one app, and the Kotlin sits in the Android project Tauri generated. `build.rs` declares the command permissions.
- **One service for the foreground mic and the overlay** instead of separate overlay and foreground services. The bubble is the reason the mic service exists, and a single service keeps their lifetimes identical.
- **Native microphone capture on Android** (`createCapture()` added to `PlatformAdapter`). The WebView's `getUserMedia` never settles while the app is hidden (explained in `ANDROID.md`). The PCM format and everything downstream stay shared.
- **WebView wake per dictation.** Chromium freezes a hidden page's timers after about 5 minutes. Without the wake, a hold after that point would start capture but never update the UI or finish.
- **The accessibility service subscribes to no events.** It reads the focused field only when inserting. For Chrome, it searches beneath the reported focus for the focused editable node.

## Changes

- **Kotlin** (`src-tauri/gen/android/app/src/main/java/com/personal/voiceapp/platform/`): `VoicePlatformPlugin`, `FloatingMicService`, `MicBubbleView`, `NativeMicCapture`, `VoiceAccessibilityService`, `TextSplice` (plus `TextSpliceTest`).
- **Android resources:** manifest permissions and the two services, `res/xml/voice_accessibility_service.xml`, `res/drawable/ic_mic.xml`, and new strings.
- **Rust:** `src-tauri/src/platform/android.rs` (plugin registration), `lib.rs` (registers it; the Windows push-to-talk hook is desktop-only), `build.rs` (plugin commands), `tauri.android.conf.json` (no indicator window on Android), `capabilities/android.json`.
- **TypeScript:**
  - `src/platform/android/`: the adapter, `NativeAudioCapture`, the plugin bridge, the setup helpers, and `AndroidSetupPanel`.
  - `PlatformAdapter.createCapture()`. Windows returns the existing `BrowserAudioCapture`.
  - `useDictation` takes capture from the adapter.
  - `App.tsx` shows the shortcut section on Windows and the floating mic section on Android. The shortcut picker moved into `PushToTalkShortcutPanel`.
- **Docs:** `ANDROID.md` and `ARCHITECTURE.md`.

## Checks

| Check | Result |
| --- | --- |
| `pnpm lint`, `pnpm typecheck` | PASS |
| `pnpm test` | PASS, 11 files / 88 tests. New tests cover push-to-talk and setup parsing, plugin error messages, capture events, trailing-chunk flush, dropping the tail on cancel, ignoring other captures' events, and stop-before-start. |
| `pnpm build` | PASS |
| `cargo clippy --all-targets -D warnings` (Windows) | PASS (the only warning is cargo's exFAT hard-link notice) |
| Rust for `aarch64-linux-android` and `x86_64-linux-android` | Builds |
| Kotlin unit tests (`TextSpliceTest`) | PASS, 5 tests |

### Emulator (Pixel 10 Pro, API 37)

| Check | Result |
| --- | --- |
| The app launches and shows the shared UI and setup panel | PASS |
| Microphone runtime prompt from **Allow**; the setup steps turn **Done** | PASS |
| **Turn on floating mic**: foreground service type `microphone`, notification, bubble over other apps | PASS |
| Holding the bubble while the app is hidden reaches the shared controller, and native capture starts | PASS |
| Native capture while hidden: 23 chunks (2.3 s of 16 kHz PCM), then `end` | PASS |
| Hold after 6 minutes hidden: timers run, indicator states and error toast shown, WebView returns to hidden afterwards | PASS |
| Insert into Messages (native field) after existing text: inserted once at the cursor | PASS |
| Insert into a Chrome web field (Bing search): inserted once by paste | PASS |
| No focused field: text is copied to the clipboard with a message | PASS |

## Not yet verified (needs you)

The emulator has no account signed in and its host mic is silent, so no real speech went through Gemini. It also isn't your phone. The acceptance test needs your Samsung:

1. Enable USB debugging on the phone, connect it, and install `C:\dev\VoiceDictationAPP-android\src-tauri\gen\android\app\build\outputs\apk\universal\debug\app-universal-debug.apk` with `adb install -r`.
2. Sign in. That needs the Phase 4 `GEMINI_API_KEY` secret and a confirmed account. Add a dictionary term.
3. In the Floating mic section, grant everything. For accessibility, Samsung may say the setting is restricted for sideloaded apps: open **App info**, tap ⋮, choose **Allow restricted settings**, then enable it. Turn on the floating mic.
4. In Chrome, Messages/Samsung Messages, ChatGPT, and Samsung Notes: focus a field, hold the bubble, speak, and release. The text should appear **once**, spelled with your dictionary term.
5. Tap a password field and dictate. Nothing should be typed, and you should see "Dictation doesn't type into password fields."
6. Leave the phone on another app for 10+ minutes, then dictate again. It should work the same.
7. Samsung's battery settings can kill background apps. If the bubble disappears, set the app to **Unrestricted** battery.

Phase 6 is **not complete** until these pass on the phone.
