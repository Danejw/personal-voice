# Android Implementation

## Goal

Reuse the shared Tauri app while adding only the native Android behavior required for system-wide dictation.

## Native plugin

Create a small Tauri Android plugin implemented in Kotlin.

Conceptual components:

```text
VoicePlatformPlugin
├── VoiceOverlayService
├── VoiceAccessibilityService
├── VoiceForegroundService
└── native permission helpers
```

Use the exact Android architecture required by current Android/Tauri APIs rather than forcing these exact class names.

## Floating microphone

Provide an optional floating microphone control over other apps.

Interaction:

```text
press/hold
→ begin utterance
release
→ finalize
→ insert text
```

The control should be small and movable.

Do not build a custom keyboard in V1.

## Accessibility Service

Use AccessibilityService to insert text into the focused editable field where Android permits it.

Requirements:

- clearly tell the user why Accessibility permission is needed
- gracefully handle fields that reject accessibility text replacement
- fall back to clipboard when appropriate
- never inspect unrelated screen content unless required for focused-field insertion or an explicit selection capture

## Foreground service

Follow current Android rules for microphone foreground services.

The app must:

- request the required permissions
- show the required ongoing notification when a foreground service is active
- handle service restarts cleanly
- avoid hidden indefinite microphone capture

## Permissions

Likely areas include:

- microphone
- draw over other apps
- accessibility service enablement
- notification/foreground-service related permissions depending on target SDK

Use current Android documentation for exact manifest entries and runtime behavior.

## Tauri boundary

Shared TypeScript should call commands/events exposed by the plugin.

Do not move shared:

- Gemini session logic
- vocabulary
- settings
- authentication
- transcript state

into Kotlin.

## Device testing

Test on the actual target Samsung phone, not only an emulator.

Test insertion into:

- Chrome
- messaging/text fields
- ChatGPT
- common note/editor apps
- password/secure fields only to verify the app appropriately does not behave unsafely

## As implemented (Phase 6)

Kotlin lives in `src-tauri/gen/android/app/src/main/java/com/personal/voiceapp/platform/`. It is an inlined plugin: `src-tauri/src/platform/android.rs` registers it, `src-tauri/build.rs` lists its commands, and `src-tauri/capabilities/android.json` grants them. The files under `.../generated/` belong to the Tauri CLI and are overwritten on build, so nothing there is edited.

| Piece | What it does |
| --- | --- |
| `VoicePlatformPlugin` | Commands for setup status, settings shortcuts, starting/stopping the floating mic, the overlay snapshot, capture, insertion, and selection capture. Emits `pushToTalk`, `overlayAction`, `floatingMicChanged`, and `audioCapture` events. |
| `FloatingMicService` | One foreground service (type `microphone`) that also owns the overlay bubble and its quick-actions panel. It shows an ongoing notification with "Turn off" and uses `START_NOT_STICKY`, so it never restarts on its own. |
| `MicBubbleView` | Tap for quick actions. Hold (~400 ms) to talk, release to insert. Dragging moves the bubble; a drag after hold starts cancels the utterance. Colour shows idle, listening, finalizing, or error. |
| `OverlayPanelView` | Compact native sheet: start dictation, destination, capture, recent notes, pending handoffs, Open Settings. |
| `NativeMicCapture` | `AudioRecord` producing 16 kHz mono PCM16 in 100 ms chunks, sent to the WebView as base64 events. Runs only between press and release. |
| `VoiceAccessibilityService` | Subscribes to no events. At insert or selection-capture time it reads only the input-focused field, never password fields. Native fields get an exact splice with `ACTION_SET_TEXT`; web and rich editors get `ACTION_PASTE`. Selection capture returns the node's highlighted substring, not a clipboard copy. Otherwise dictated text goes to the clipboard with a message. |

Shared TypeScript still does everything else: Gemini, vocabulary, settings, auth, and transcript state. `AndroidPlatformAdapter` is a thin bridge; the setup UI is `src/platform/android/AndroidSetupPanel.tsx`.

### Deviations found on a device/emulator

- **Capture is native, not `getUserMedia`.** Tauri's generated `RustWebChromeClient` asks the activity for permission on every `getUserMedia`, and Android delivers that result only once the activity is visible again. From the floating mic the promise never settles, so capture moved behind `PlatformAdapter.createCapture()`.
- **The WebView is woken for each dictation.** While the app is hidden, Chromium throttles page timers, and after about 5 minutes it freezes timers and message tasks, which stops React and the controller. On press, the plugin calls `WebView.onResume()` and `dispatchWindowVisibilityChanged(VISIBLE)`. When the indicator returns to idle, it restores the real visibility. Verified after 6 minutes hidden: timers ran at full speed during the hold.
- **The foreground service starts only from the visible app.** Android 14+ forbids starting a microphone foreground service from the background, and `SYSTEM_ALERT_WINDOW` doesn't exempt it, so "Turn on floating mic" lives in the app's setup panel.
- **Chrome focus lookup.** Chrome reports its content view as the input focus, with the real field as a focused virtual child. When the focused node isn't editable, the service searches beneath it (bounded to 2,000 nodes) for the focused editable node.
- **Paste leaves the text on the clipboard.** Android 10+ doesn't let a background service read the clipboard, so the previous clip can't be restored.
- **Selection capture is focused-field only.** Highlighted text on a web page or other non-editable surface is not read. The service still never subscribes to accessibility events.

### Phase 9 polish

- The bubble is kept on screen: its saved position is clamped when it appears and again on rotation. Before, a position saved near the right edge in landscape could leave it off screen in portrait.
- Android has no microphone picker. `NativeMicCapture` records from `AudioSource.VOICE_RECOGNITION`, which Android routes to a wired headset when one is plugged in. Bluetooth headset mics aren't used, because that needs SCO routing.
- The floating-control visibility setting is Windows-only. On Android the bubble is the control; tap expands quick actions, hold dictates, and errors also appear as a toast.

### Building on this machine

The repo is on an exFAT drive (E:), which can't hold symlinks. `tauri android build` symlinks the Rust library into `jniLibs` and fails there. On NTFS it also needs Windows Developer Mode. Until the project is moved or Developer Mode is on:

1. Mirror the repo to NTFS (e.g. `C:\dev\VoiceDictationAPP-android`, excluding `node_modules`, `target`, and Gradle build dirs), then run `pnpm install`.
2. Run `pnpm tauri android build --debug --apk --target <aarch64|x86_64>` there. It compiles the library, then fails at the symlink step. Build one target per run.
3. Copy `src-tauri/target/<triple>/debug/libpersonal_voice_app_lib.so` into `gen/android/app/src/main/jniLibs/<abi>/`.
4. From `gen/android`: `gradlew assembleUniversalDebug testUniversalDebugUnitTest -x rustBuildUniversalDebug -x rustBuildArm64Debug -x rustBuildX86_64Debug -PabiList=arm64-v8a,x86_64 -ParchList=arm64,x86_64 -PtargetList=aarch64,x86_64`.

For a signed release build, the same steps use the release profile; see `docs/RELEASING.md`.

## APK distribution

For personal V1:

- create a signed APK
- install directly on controlled devices
- keep the signing key backed up securely
- use the same signing key for all future updates

The release build, key location, backup steps, and CI variables are in `docs/RELEASING.md`.
