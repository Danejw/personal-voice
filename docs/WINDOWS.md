# Windows Implementation

## Goal

Windows is the first fully usable platform.

## Responsibilities

Windows-specific code should handle:

- global push-to-talk shortcut
- microphone/device integration where Tauri/web APIs are insufficient
- text insertion
- clipboard preservation
- system tray
- start at login
- floating Personal Voice control
- packaging

## Push-to-talk

Initial behavior:

```text
key down
→ begin utterance

key up
→ end utterance
→ wait for final transcript
→ insert
```

The shortcut must eventually be configurable.

Prevent repeated keydown events from creating duplicate sessions.

## Text insertion

Start with clipboard-based insertion.

Algorithm:

```text
capture current clipboard payload where safely possible
set transcript
send Ctrl+V to focused app
wait only as much as required for reliable paste
restore previous clipboard
```

Be careful with non-text clipboard formats.

If preserving arbitrary clipboard formats is complex, document the limitation instead of corrupting clipboard data.

## Focus

The target application is the application/text field focused when insertion occurs.

Do not create per-app integrations in V1.

## Tray behavior

Closing the main window should optionally keep the dictation utility running in the system tray.

Provide:

```text
Open Personal Voice
Show floating control
Pause dictation
Quit
```

Keep tray behavior minimal. Closing or minimizing the main window hides it to the tray; only Quit exits.

## Startup

Support launch at user login after dictation itself is stable.

## Floating control

A tiny always-on-top Personal Voice button is enough for day-to-day use.

States:

```text
Idle (Personal Voice)
Listening
Transcribing
Error
```

Clicking the idle button expands a compact overlay: start dictation, destination, capture selection, recent notes, pending handoffs. Listening uses the same button. Do not build a complex waveform UI in V1.

## Test applications

At minimum manually test:

- Notepad
- Chrome
- Edge
- Cursor
- VS Code
- ChatGPT web/app if available
- common textarea/contenteditable fields

Document failures by application rather than adding hacks immediately.

## As implemented (Phase 2)

- **Push-to-talk** uses a `WH_KEYBOARD_LL` hook (`src-tauri/src/platform/windows/hook.rs`), not `RegisterHotKey`. The hook reports key-up and allows a lone key.
  - The default is Right Alt. Each action (dictate, note, handoff, capture selection) can record several bindings: one key or mouse button, optionally with Ctrl, Shift, Alt, or Win. A mouse button and a keyboard shortcut can both start the same action. Voice note and handoff bindings hold-to-talk into that destination for one utterance. Capture selection fires once on press.
  - A `WH_MOUSE_LL` hook covers the mouse buttons. Bound buttons are swallowed so Mouse 4/5 do not also trigger Back/Forward.
  - The shortcut key is swallowed, so Alt never activates app menus. Auto-repeat is ignored while held.
  - Escape is swallowed only while an utterance is cancellable.
  - Input the app synthesizes is tagged via `dwExtraInfo` and ignored.
  - **AltGr layouts:** Windows injects a Left Ctrl alongside Right Alt. The exact-modifier match then fails, so Right Alt won't trigger dictation. Record a different key on those layouts.
- **Insertion** (`insert.rs`):
  1. Snapshot the clipboard's HGLOBAL formats, up to 64 MB. GDI-handle and private formats are skipped. Content that exists only as a metafile, palette or private format is not restored.
  2. Set `CF_UNICODETEXT`, excluded from clipboard history, cloud clipboard and monitors.
  3. Wait up to 1 s for Shift/Alt/Win/Ctrl to be released.
  4. `SendInput` Ctrl+V, then wait 400 ms.
  5. Restore the snapshot only if the clipboard sequence number is unchanged.
- **Elevated targets:** UIPI silently blocks `SendInput` into apps running as administrator. `SendInput` does not report this, so the paste simply does not appear.
- **Overlay:** four small always-on-top buttons pinned to the bottom-right of the primary display's work area, just above the taskbar. The position is recalculated for that screen's resolution and DPI, and snapped back if the window moves. Clicks work; `WS_EX_NOACTIVATE` plus `SW_SHOWNOACTIVATE` keep the previous app focused so insertion still lands there.
- **WebView2 flags** (`additionalBrowserArgs`, identical on both windows as WebView2 requires):
  - `--autoplay-policy=no-user-gesture-required`, because a hotkey is not a page user gesture and the AudioContext would otherwise stay suspended.
  - Background-throttling switches, because the main window is usually hidden.
- **Tray:** closing or minimizing the main window hides it (and the taskbar button). Left-click opens Personal Voice. Right-click offers Open Personal Voice, Show floating control, Pause dictation, and Quit. Quit lives only in the tray menu.

## As implemented (Phase 9 polish)

- **Single instance** (`tauri-plugin-single-instance`, desktop only). A second launch exits and brings the running window forward. Before this, a second copy installed a second keyboard hook, and every transcript was pasted twice.
- **Launch at startup** (`platform/windows/autostart.rs`): an HKCU `…\CurrentVersion\Run` value named `Personal Voice`, set to `"<exe>" --autostart`. It's toggled from "On this PC" in Settings, and the toggle reads as on only if the value points at this exe.
  - A `--autostart` launch keeps the main window hidden and dictation runs from the tray. Every other launch shows the window, which now starts hidden (`visible: false`) so it no longer flashes on autostart.
  - The NSIS uninstaller removes the value (`windows/hooks.nsh`), except during an updater reinstall.
  - If Task Manager's "Startup apps" disables the entry, Windows keeps the value but skips it, and the toggle still reads as on. Re-enable it there.
- **Insertion no longer waits for the restore.** `insert_text` returns right after Ctrl+V; a background thread waits 400 ms, then restores the clipboard. The next insertion, and app exit, wait for that restore to finish first. Measured final→inserted went from ~420 ms to 14–26 ms.
- **Microphone choice:** "Push-to-talk → Microphone", stored in `localStorage` on this PC and read at each press. It's opened with `deviceId: { exact }`, because WebView2 ignored `ideal` and opened the default device. If the chosen mic is unplugged, capture falls back to the system default and the picker lists it as "not connected".
- **Overlay:** four round buttons — mic, note, handoff, Settings. The mic click starts and stops dictation. Hold the note or handoff button to send that utterance there without changing the saved destination. "Show floating control" can hide them.
- **Tray tooltip:** "Personal Voice", or "Personal Voice: dictation paused" while paused.
