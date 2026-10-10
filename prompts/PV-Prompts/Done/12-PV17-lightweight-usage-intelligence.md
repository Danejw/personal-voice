# BUILD ORDER 12 — PV17: Lightweight Usage Intelligence

## Goal
Implement **PV17 — Lightweight Usage Intelligence**.

This is private operational telemetry for improving my own app.

Track structured events such as:

```text
dictation_started
dictation_completed
dictation_failed
recovery_used
destination_used
`voice_note_created` (legacy metrics key)
handoff_created
selection_captured
platform
duration
```

Do NOT put transcript text into telemetry. Do NOT store microphone audio. Do NOT introduce a third-party analytics service.

Prefer simple local aggregates, syncing only what is genuinely useful across devices.

Add one user setting to disable usage intelligence. Telemetry failure must never break dictation.

Document the event schema. Stop after PV17.
