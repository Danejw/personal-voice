# Phase 05 — Controls

## Starting state

Windows overlay send button started hold-to-handoff on pointer down. Android panel had a Handoff destination chip only.

## Files changed

- `src/overlay/overlay.ts` (+ tests)
- `src/overlay/OverlayDock.tsx`
- `src/overlay/useOverlay.ts`
- `src/app/app.css`
- `src/remote-dictation/gesture.ts` (+ tests)
- `src-tauri/gen/android/.../OverlayPanelView.kt`

## Schema changes

None.

## Architecture decisions

- Hold threshold centralized at 300ms
- New overlay actions: `cycle-remote-target`, `remote-dictate-hold`
- Snapshot fields for target label/online/count/active
- Kotlin emits actions only; TypeScript owns transport

## Tests

Overlay action parsing rejects malformed hold payloads.

## Real-device validation

NOT RUN.

## Deviations

Compact 8-character badge on the Windows overlay button plus tooltip for the full name.

## Blockers

None.
