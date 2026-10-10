# BUILD ORDER 22 — PV29: Offline Queue for Sync Actions

The current `PersonalSyncStore` intentionally becomes read-only when Supabase is unavailable. We now have enough synced functionality to justify controlled offline writes.

## Goal
Implement **PV29 — Offline Queue for Sync Actions**.

Support safe local queuing of appropriate mutations while offline, such as:

```text
create note
archive note
create handoff
dictionary/settings changes where safe
```

Use a small durable local outbox. Each operation needs a stable ID so retries do not create duplicates.

Replay in order when connectivity returns.

Do not build distributed synchronization or CRDTs. Define conflict behavior explicitly.

For simple entities, server-confirmed latest state is acceptable where appropriate.

Sensitive content must remain scoped to the signed-in user.

Add tests for restart while offline, reconnect, duplicate retry, account switch, deletion, and failed operation.

Stop after PV29.
