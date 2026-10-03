# Phase 04 — Dictation destination

## Starting state

`send-to-device` delivered through HandoffStore.send.

## Files changed

- `src/voice/transcript/TranscriptDestination.ts` (+ tests)
- `src/remote-dictation/RemoteDictationDestination.ts` (+ tests)
- `src/app/App.tsx` / `src/app/useDictation.ts`
- History, usage, push-to-talk, Windows DestOverride string (`remote-dictation`)
- Hotkey label + legacy `handoffHotkey` migration

## Schema changes

None.

## Architecture decisions

- Destination locks target at utterance start
- Failure preserves transcript via existing DictationController ERROR path
- Handoffs inbox unchanged for manual/Assistant sends

## Tests

Destination lock/migrate/router tests updated.

## Real-device validation

NOT RUN.

## Deviations

Usage trigger id remains `shortcut-handoff` for analytics continuity.

## Blockers

None.
