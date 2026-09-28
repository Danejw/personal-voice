# Phase 2 — Windows System-Wide Dictation

Read:

- `AGENTS.md`
- `docs/SPEC.md`
- `docs/ARCHITECTURE.md`
- `docs/WINDOWS.md`

Assume Phase 1 transcription already works.

## Goal

Make the Windows app useful as a real system-wide push-to-talk dictation utility.

## Implement

- configurable global push-to-talk shortcut with a sensible default
- key-down begins one utterance
- key-up finalizes the utterance
- minimal listening/finalizing indicator
- finalized transcript inserts into the currently focused application
- initial insertion may use clipboard + paste
- preserve/restore prior clipboard content as safely as practical
- app can continue running from system tray
- clean cancel/error behavior

Do not add:

- Supabase
- Android
- dictionary sync
- release updater
- multiple providers
- assistant functionality

## Reliability details

Prevent:

- repeated keydown from creating multiple sessions
- one utterance inserting twice
- stale transcripts inserting into the next app/session

If focus changes while speaking, use the focused field at insertion time unless implementation constraints require a documented alternative.

## Manual tests

Test at minimum:

- Notepad
- Chrome textarea
- Cursor or VS Code
- another common editable field

## Acceptance criteria

The user can:

```text
focus a text field
hold the configured hotkey
speak
release
see the transcript inserted once
```

The main window does not need to be focused.

Report application-specific insertion failures instead of adding hacks outside the platform layer.

Stop after Phase 2.
