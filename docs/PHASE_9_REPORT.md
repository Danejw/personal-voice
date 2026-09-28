# Phase 9 implementation report — V1 polish

## Scope

Only `prompts/09-polish.md`: the items it lists to review, plus measured latency fixes. There's no dashboard, analytics, waveform, meeting feature, assistant, extra provider, or offline speech recognition, and nothing from Phase 10.

## Latency, measured

Dev builds now record per-utterance timings (`src/voice/session/timings.ts`) and log one `[latency]` line per utterance. The runs below used a fixed 3.4 s clip through push-to-talk into Notepad on this PC.

| Segment | Before | After | What decides it |
| --- | --- | --- | --- |
| press → first audio chunk | 120–200 ms | 140–185 ms | Windows opening the microphone. Unchanged: the only fix is keeping the mic open between utterances, which the privacy rules forbid. |
| press → live session | 425–690 ms (+400–900 ms when the prefetched token has expired) | same | Gemini's connect time. Audio is buffered meanwhile, so it only delays the transcript for utterances under about 1.4 s. Left as is. |
| release → final transcript | 460–640 ms | 460–610 ms | Gemini. Unchanged. |
| final → inserted | ~420 ms | 14–26 ms | Was the 400 ms clipboard-restore wait. Insertion now returns after Ctrl+V and restores the clipboard in the background. |
| silent recording → error shown | 23.6–26 s | ~1.2 s | Was the 10 s final timeout plus recovery. Gemini's `ACTIVITY_END` now ends the wait after 750 ms, and an empty transcript is the error "No speech detected…". |

## What changed

- **Startup:** a second launch hands over to the running app and exits (`tauri-plugin-single-instance`). Two copies used to paste every transcript twice. The main window starts hidden and is shown unless the launch is `--autostart`.
- **Launch at startup (Windows):** "Start with Windows" under "On this PC" writes an HKCU Run value, and the app starts in the tray. The uninstaller removes the value, except during an update.
- **Microphone selection (Windows):** a picker with the system default and each input. It refreshes when devices change, and the choice is local to this PC.
- **Indicator:** "Finalizing" is now "Transcribing". "Show listening indicator" can turn the pill off; errors still show.
- **Status and layout:** the header reads "Personal Voice", and the status is in words (Ready, Listening, Transcribing, Typing, "Sign in to start dictating", "Paused from the tray"). "Record" became "Test dictation". Sections are ordered Dictation, Account, platform, Transcription, Dictionary, Updates. Long device names no longer overflow their card.
- **Account and sync:** the sync line and Retry moved under the account. The edit panels say why they're read-only. Offline, sync retries by itself when the connection returns or the window is opened.
- **Error copy:**
  - The final-transcript timeout now reads "Transcription didn't finish. Try again."
  - A token failure reads "Couldn't start transcription…".
  - An offline press used to say "Could not reach the sign-in service", which wrongly suggested a sign-in problem. It now reads "Couldn't connect to start transcription. Check your internet connection and try again."
  - A disconnect keeps its close code, and shows the server's reason only for refusals (1007/1008).
- **Tray:** the tooltip says when dictation is paused.
- **Android overlay:** the bubble's position is clamped on screen when it appears and on rotation.

## Deviations

- **`deviceId: { exact }`, not `ideal`.** WebView2 treated `ideal` as a hint and opened the `default` device anyway. So the capture asks for the exact device, and falls back to the default only on `OverconstrainedError` or `NotFoundError`.
- **No microphone picker on Android.** Native capture uses `VOICE_RECOGNITION`, which Android routes to a wired headset by itself. A picker would need `AudioRecord.setPreferredDevice` plus Bluetooth SCO handling, which is new scope.
- **Version bumped to 0.3.0** so the release smoke tests could install over 0.2.1. There's no tag and no GitHub release; publishing is your call.

## Changes by file

- **Rust:** `platform/windows/autostart.rs` (new); `insert.rs` (background restore, `finish_pending_restore` on exit); `lib.rs` (single instance, hidden start, exit hook); `tray.rs` (tooltip); `commands` (`get/set_launch_at_login`); `platform/mod.rs` (`AUTOSTART_ARG`, stubs for other platforms). `Cargo.toml` adds `tauri-plugin-single-instance =2.5.0` (desktop only) and the `Win32_System_Registry` feature. The new `Cargo.lock` entries are that plugin's Linux D-Bus dependencies; Windows and Android don't compile them.
- **Config:** main window `visible: false`; NSIS `installerHooks` → `src-tauri/windows/hooks.nsh`.
- **Kotlin:** `FloatingMicService.kt` (clamp on show, drag, and rotation).
- **TypeScript:**
  - New files:
    - `components/Toggle.tsx` and `components/SelectField.tsx`, reused by four panels.
    - `settings/deviceSettings.ts`.
    - `platform/microphones.ts`.
    - `platform/windows/MicrophonePanel.tsx` and `platform/windows/WindowsBehaviorPanel.tsx`.
    - `sync/SyncStatus.tsx`.
    - `voice/session/timings.ts`.
  - `platform/index.ts` returns the `AppPlatform` union, so Windows-only settings need no Android stubs.
  - Edits in `DictationController`, `GeminiProvider`, `BrowserAudioCapture`, `WindowsPlatformAdapter`, `useDictation`, `usePersonalSync`, `App.tsx`, the sync panels, `Indicator.tsx`, and `app.css`.
  - Relative imports in the edited files were converted to `@/`.
- **Tests:** 123, up from 111. New ones cover timings, no speech, the `ACTIVITY_END` grace (silent, committed, a late final counted once, a pending interim), device settings, the microphone options, and the disconnect copy.
- **Docs:** `ARCHITECTURE.md`, `WINDOWS.md`, `ANDROID.md`, `TESTING_RELEASES.md`.

## Checks

| Check | Result |
| --- | --- |
| `pnpm check` | PASS, 17 files / 123 tests |
| `cargo fmt --check`, `cargo clippy --all-targets` | PASS, no warnings |
| Windows release build, signed updater artifact | PASS, `Personal Voice_0.3.0_x64-setup.exe` + `.sig` |
| Android release APK | PASS, `versionCode` 3000, certificate SHA-256 matches the release key |

### Windows release smoke test (installed 0.3.0 over 0.2.1)

| Item | Result |
| --- | --- |
| launch app | PASS |
| login/token acquisition | PASS (you signed in; 0.2.1 had never been signed in) |
| microphone works | PASS on the dev build: the real mic opens, including the chosen device by exact ID. The installed-build runs used a recorded clip in place of the mic. |
| hotkey starts exactly one utterance | PASS: one process after a second launch, one paste per run |
| release finalizes | PASS in about 15 runs this phase, except once (see open issues) |
| inserts into Notepad | PASS |
| inserts into a browser textarea (Edge) | PASS |
| inserts into Cursor/VS Code | not run: it would have typed into this editor session |
| clipboard behavior | PASS: a sentinel clipboard value came back after every paste |
| network disconnect | PASS: offline gives a clear error at release, and the next press works once the network is back |
| app restarts cleanly | PASS |
| tray quit exits | PASS |
| launch at startup | PASS on the dev build: the Run value is written and removed, a `--autostart` launch stays hidden and dictates, and a normal launch shows the window |

### Android release smoke test (emulator, 0.3.0 over 0.2.1)

| Item | Result |
| --- | --- |
| install signed APK over previous version | PASS: updated in place; sign-in, microphone and notification permissions kept |
| login/token acquisition | PASS: a session connected, and Gemini ended the (silent) activity |
| microphone permission | PASS (kept) |
| overlay permission path | PASS: **Open settings** opens "Display over other apps", and the step turns Done on return |
| accessibility setup path | PASS: **Open settings** opens Accessibility settings, and the step turns Done on return |
| overlay starts one utterance | PASS: bubble held over Messages |
| release finalizes | PASS: "No speech detected…" toast about 1.5 s after release (the emulator's host mic is silent) |
| text inserts into external apps | not run: no speech reaches the emulator. It passed in Phase 6, and still needs your phone. |
| foreground-service notification | PASS: type microphone; **Turn off** stops the service and removes the bubble |
| network disconnect | PASS: error toast at release |
| background/foreground transitions | PASS: the bubble worked over Messages and Chrome; the setup panel refreshed after each settings screen |
| bubble after rotation | PASS: dragged to x = 2550 in landscape, clamped to x = 1100 in portrait |

## Open issues

1. **One lost push-to-talk release.** The first press in one fresh instance of the release build stayed on "Listening" after Right Alt came up. The next tap finished it normally. It didn't happen in about 15 other runs, including two fresh-launch trials with an event logger, which saw every press and release reach the app. The cause isn't known. I tried raising the hook thread's priority as a guess, then reverted it. If it happens again, tap the key once; recording also stops by itself after 5 minutes.
2. **Your phone:** real speech into external apps (the Phase 6 device checklist) still needs a real Android device.
3. **"Start with Windows" and Task Manager:** if the entry is disabled under Task Manager's "Startup apps", Windows keeps the value but skips it, and the toggle still reads as on.
4. **Offline copy on devices:** the new offline wording was written after these builds, so the installed 0.3.0 apps still show the old message. It ships in the next build.

Phase 9 is complete on this PC and the emulator. Phase 10 wasn't started.
