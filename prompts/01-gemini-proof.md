# Phase 1 — Gemini Transcription Proof

Read:

- `AGENTS.md`
- `docs/SPEC.md`
- `docs/ARCHITECTURE.md`

Implement only Phase 1.

## Goal

Prove that the app can capture microphone audio and obtain a transcript from the current Google Gemini dedicated live transcription API.

## Critical API instruction

Before writing provider code, verify the current official Google Gemini API documentation.

Confirm:

- current dedicated transcription model ID
- current Live/WebSocket connection method
- required audio format
- current transcription configuration
- partial/final transcript event format
- current custom vocabulary mechanism
- current Smart transcription mechanism

Do not rely blindly on old field names in project docs.

Document the exact API/model used.

## Scope

Inside the app only:

```text
Record button
→ capture microphone
→ stream to Gemini
→ Stop button
→ show partial/final transcript in the app
```

For this proof phase, a developer-only credential path may be used locally if necessary, but:

- never commit secrets
- clearly isolate credential handling
- do not package a permanent key into a release build

Do not implement:

- global hotkey
- external text insertion
- Supabase token endpoint
- dictionary sync
- Android overlay
- AccessibilityService
- release packaging

## Architecture

Keep all Gemini-specific code behind the voice-provider/session boundary.

Normalize provider events into application-level partial/final/error events.

Use the app state lifecycle rather than unrelated booleans.

## Acceptance criteria

- user can press Record
- microphone audio reaches Gemini
- partial transcript can appear if supported
- Stop/finalize yields one final transcript
- transcript appears in the app UI
- duplicate final events do not duplicate output
- provider errors produce a controlled error state
- secrets are not committed

Add focused tests for transcript/session state handling.

At the end, report the exact current Gemini API/model/configuration used and stop.
