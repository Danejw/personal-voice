# Phase 6 — Android System-Wide Dictation

Read:

- `AGENTS.md`
- `docs/SPEC.md`
- `docs/ARCHITECTURE.md`
- `docs/ANDROID.md`

Assume the shared Gemini provider, auth, dictionary, and settings already work.

## Goal

Add Android without duplicating the app.

## Architecture rule

Remain inside the same Tauri 2 project.

Create only the native Kotlin-backed Tauri plugin/services required for Android platform integration.

Do not move shared voice logic into Kotlin.

## Implement in steps

### Step 1

Verify the existing Tauri app can:

- run on Android
- capture microphone
- use the shared Gemini transcription provider
- display the transcript inside the app

### Step 2

Add current-Android-compliant native support for:

- floating microphone overlay
- microphone foreground service where required
- AccessibilityService text insertion
- permission/setup UX

### Interaction

```text
hold floating mic
→ begin utterance
release
→ finalize
→ insert transcript into focused editable field
```

## Current API requirement

Use the current Android target SDK rules for:

- microphone foreground services
- overlay permission
- accessibility service declaration
- notification requirements

Do not copy outdated manifest snippets blindly.

## Privacy

AccessibilityService should be narrowly scoped to text insertion.

Do not collect unrelated screen content.

## Testing

Test on a real Android device, not only an emulator.

## Acceptance criteria

On the real device:

```text
open another app
focus an editable field
hold overlay mic
speak
release
text inserts once
```

Shared dictionary/settings from the same account are used.

Stop after Android works.
