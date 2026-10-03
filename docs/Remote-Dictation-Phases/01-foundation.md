# Phase 01 — Foundation / audit

## Starting state

Camera Context was already on `development`. Dictation destinations were `active-field`, `voice-note`, and `send-to-device` (persistent Handoffs). Overlay send button held immediately into `send-to-device`. Device presence used `REMOTE_ONLINE_MS` (45s). `last_seen` was refreshed by remote-read / computer-action polls.

## Reused

- `DictationController` + `TranscriptDestination` boundary
- `PlatformAdapter.insertReceivedText`
- Device list / `devices.last_seen` / 45s online window
- Supabase auth + SECURITY DEFINER RPC patterns
- Overlay snapshot / action pipeline (Windows + Android)
- Existing Handoffs inbox (unchanged as a separate feature)

## Replaced / separated

- Dictation destination `send-to-device` → `remote-dictation` (legacy prefs migrate)
- Overlay send hold → tap-to-cycle / hold-to-remote-dictate
- New `remote_dictation_requests` table (not `handoffs`, not `device_action_requests`)

## Schema changes

None in this phase (documented intent only).

## Architecture decisions

- Dedicated `src/remote-dictation/` domain + `src/services/remoteDictationService.ts`
- Target selection is source-device local preference, not HandoffStore.targetDeviceId
- Allow remote dictation defaults ON via `!== false`

## Tests

NOT RUN in isolation (covered with later phases).

## Real-device validation

NOT RUN.

## Deviations

None.

## Blockers

None.
