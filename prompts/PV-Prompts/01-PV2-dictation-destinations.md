# BUILD ORDER 01 — PV2: Dictation Destinations

Work in the existing `Danejw/personal-voice` repository. Treat the current code on `main` as ground truth.

Before changing code, read `AGENTS.md`, `docs/SPEC.md`, `docs/ARCHITECTURE.md`, and inspect the current `DictationController`, `useDictation`, `PlatformAdapter`, Gemini provider, and app UI.

## Goal
Implement **PV2 — Dictation Destinations**.

Currently a finalized transcript flows directly into `platform.insertText()`. Refactor this so transcription and destination are separate concepts:

```text
Gemini 3.5 Transcribe
→ final transcript
→ TranscriptDestination
   └─ Active Field
```

For this phase, **Active Field is still the only actual destination**. Create the smallest clean destination interface/router necessary so future phases can add Voice Note, Clipboard, Handoff, etc. without modifying the transcription engine.

Do not change Gemini behavior, the existing push-to-talk experience, or create Assistant Mode. Do not introduce an event bus or oversized abstraction.

## Acceptance
- Existing dictation behaves identically.
- `DictationController` no longer needs to know that every transcript must be inserted into the active field.
- Destination failures still surface correctly.
- Existing recovery logic remains unchanged.
- Tests cover destination delivery.

Run `pnpm check` plus relevant native checks. Report what changed and stop.
