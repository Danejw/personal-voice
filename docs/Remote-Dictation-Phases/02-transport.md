# Phase 02 — Transport

## Starting state

No Remote Dictation table existed. Cross-device text used `handoffs` or `device_action_requests`.

## Files changed

- `supabase/migrations/20261003120000_remote_dictation_requests.sql`
- `src/services/remoteDictationService.ts`
- `src/services/remoteDictationService.test.ts`
- `src/remote-dictation/types.ts`
- `src/remote-dictation/remoteDictationFeed.ts`
- `src/types/database.ts`

## Schema changes

Table `remote_dictation_requests` with statuses `pending | processing | inserted | failed`, short `expires_at`, RLS denied for direct client table access, RPCs:

- `create_remote_dictation_request`
- `claim_remote_dictation_request` (atomic, refuses expired)
- `complete_remote_dictation_request` (inserted refuses after expiry)
- `get_remote_dictation_request`
- `list_pending_remote_dictation_requests` (expires stale pending first)
- `delete_remote_dictation_request`

Realtime publication added for the table.

## Architecture decisions

- Exactly-once via claim RPC `FOR UPDATE` + status transition
- Sender deletes after observing terminal status
- No edge functions

## Tests

Unit coverage for error mapping. Full RPC security requires a deployed migration.

## Real-device validation

NOT RUN (migration must be applied to the Supabase project).

## Deviations

TTL configurable in RPC (default 6s) within 3–15s bounds.

## Blockers

Apply migration to the live Supabase project before end-to-end device tests.
