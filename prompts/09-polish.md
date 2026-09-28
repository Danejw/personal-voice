# Phase 9 — V1 Polish

Read all core docs.

## Goal

Polish the existing V1 without expanding product scope.

## Review and improve

- startup/login behavior
- microphone selection
- hotkey configuration
- listening/finalizing/error indicator
- permission/setup UX
- dictionary management
- account/sync status
- reconnection messages
- tray behavior
- Android overlay behavior
- launch at startup
- error copy

## Keep UI minimal

Do not add:

- dashboard
- transcript analytics
- waveform-heavy UI
- meeting features
- AI assistant
- additional providers
- offline ASR

## Performance

Measure and reduce obvious latency between:

```text
press → capture starts
release → final transcript
final transcript → insertion
```

Do not optimize based on guesses.

## Acceptance criteria

The V1 experience feels like a small utility rather than a developer prototype.

Run both Windows and Android release smoke tests from `docs/TESTING_RELEASES.md`.

Stop after polish.
