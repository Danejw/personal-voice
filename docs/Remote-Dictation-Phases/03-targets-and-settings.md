# Phase 03 — Targets and settings

## Starting state

HandoffStore owned a broadcast-capable target. No Allow remote dictation preference.

## Files changed

- `src/remote-dictation/targets.ts` (+ tests)
- `src/remote-dictation/constants.ts`
- `src/remote-dictation/RemoteDictationStore.ts` (+ tests)
- `src/settings/deviceSettings.ts` (+ tests)
- `src/platform/windows/WindowsBehaviorPanel.tsx`
- `src/app/App.tsx` (Android toggle)

## Schema changes

None.

## Architecture decisions

- Eligible targets: other devices, online within 45s, deterministic name/id order
- Persist `remoteDictationTargetDeviceId` per source device
- `remoteDictation !== false` default ON; `remoteComputerActions` remains default OFF
- Store heartbeat keeps `last_seen` fresh without depending on Assistant

## Tests

Target exclusion/cycle/recovery and preference defaults covered by unit tests.

## Real-device validation

NOT RUN.

## Deviations

None.

## Blockers

None.
