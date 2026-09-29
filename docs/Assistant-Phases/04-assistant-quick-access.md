# Assistant 04 — Quick access

Prompt: `prompts/assistant-prompts/04-assistant-quick-access.md`

Branch: `assistant`

## Phase goal

Use Assistant from the existing background and floating controls without taking over Dictation:

```text
Windows shortcut or floating Assistant button
→ Assistant listens and speaks
→ main window can stay hidden

Android floating panel
→ an explicit Assistant button
→ the dictation bubble stays dictation
```

## Starting state that mattered

Phase 03 already had barge-in, resumption, and playback in the main window. The Windows hook already routed Dictate, Voice Note, Handoff, and Selection, with conflict checks in TypeScript and Rust. The always-on-top indicator and the Android floating panel only drove dictation. Android already wakes the hidden WebView for one dictation utterance, because Chromium otherwise throttles timers and audio. `DictationController` was left unchanged.

## What shipped

Windows Settings has an Assistant binding, stored on this device with the other shortcuts. It is empty until recorded. A press emits `toggle-assistant`. That event starts Assistant when it is idle or failed, and ends it when it is connecting, listening, or responding. Releasing the key does not emit a dictation release. The same key cannot be saved on two actions. Tray Pause still passes every global shortcut through, including Assistant, because the hook is paused as a whole.

The Windows floating control gained a fifth button. The mic, voice note, and handoff buttons are unchanged. The new button shows idle, listening (pulse), speaking (amber), or error. Clicking it starts or ends Assistant in the shared controller. It does not open the main window. The indicator window is taller so the extra button fits (`OVERLAY_H` 194).

Android's floating panel has a separate button: Start Assistant, End Assistant, or Retry Assistant, plus a line that says listening, speaking, or the error. The bubble tap and Start dictation still mean dictation. While Assistant is listening or speaking, the existing WebView wake stays on, so the microphone and speakers can keep working after the user leaves the app. It sleeps again when both dictation and Assistant are idle, or when Assistant has failed and dictation is idle.

Playback calls `resume()` if the Web Audio context is suspended, then plays the chunk. That is the support for a hidden Windows window. There is no second audio device path.

## Files

- `src/settings/pushToTalk.ts`, `src/settings/deviceSettings.ts` — Assistant binding and conflict check
- `src/platform/windows/PushToTalkShortcutPanel.tsx`, `WindowsPlatformAdapter.ts`
- `src/platform/pushToTalkEvent.ts`, `src/app/useDictation.ts`, `src/app/App.tsx`
- `src/overlay/overlay.ts`, `useOverlay.ts`, `OverlayDock.tsx`
- `src/assistant/PcmPlayback.ts`
- `src-tauri/src/platform/windows/push_to_talk.rs`, `hook.rs`, `mod.rs`, `commands/mod.rs`
- `src-tauri/gen/android/.../OverlayPanelView.kt`, `VoicePlatformPlugin.kt`
- `docs/ARCHITECTURE.md`

The assistant token body was not changed. `DictationController` was not edited.

## Model, API, and config

Same Gemini 3.8 Live socket as phase 03. No new endpoint. The shortcut is local Windows state, not an account setting.

## Schema

None.

## Platform behavior

Windows: global hook, device-local binding, always-on-top button, playback `resume()` while the main window is hidden. The shortcut does not show Settings.

Android: explicit panel button. Kotlin only paints the button and keeps the existing WebView wake for the Assistant session. Capture is still native `AudioRecord`. Playback is still Web Audio in the WebView.

## Automated checks

`pnpm check` passed: lint, `tsc --noEmit`, 41 files, 270 tests.

`pnpm build` passed.

`cargo test --lib push_to_talk` passed: 12 tests, including the Assistant shortcut not starting or releasing dictation, and a shared key being rejected.

Covered: keybinding conflicts, Assistant versus dictation routing, overlay `assistant-toggle`, WebView-awake while Assistant is listening or speaking, suspended-context resume, and the existing dictation suite.

Not run: a live Gemini session, speakers with the Windows window hidden, or an Android device.

## Manual test

Record an Assistant shortcut in Settings first. It has no default. Example: `Ctrl+Alt+A`, as long as it is not already used by Dictate, Voice Note, Handoff, or Selection.

### Windows

1. Hide Personal Voice to the tray. Leave the floating control visible.
2. Press the Assistant shortcut.
3. Ask: `Say Assistant mode.`
4. Pass if Assistant listens and speaks without opening the main window. The Assistant button pulses while listening and turns amber while speaking.
5. End from that floating button.
6. Use the normal Dictation hotkey and pass if insertion still works.

### Android

1. Leave the main app with the floating mic on.
2. Open the panel and tap **Start Assistant**. Do not use the bubble or Start dictation.
3. Ask a question and listen for the answer. The panel should say Assistant is listening, then speaking.
4. Tap **End Assistant**, then dictate into a field with the normal floating mic.

Pass only if the Assistant control is a different control from Dictation on both platforms.

## Known limitations

- Hidden-window speech and the Android floating session were not verified on a device or against Gemini.
- If WebView2 refuses to resume audio while the main window is hidden, the reply stays silent. There is no native speaker fallback.
- The Assistant shortcut does nothing until one is recorded, and it does nothing while dictation is paused from the tray.
- Starting Assistant while dictation holds the microphone fails with the existing lease message. It does not cancel the dictation.
- No selection context, tools, Search, screenshots, saved memory, or remote context.

## Next-phase boundary

Stop here. Do not add selection context, tools, Search, screenshots, remote context, or memory.
