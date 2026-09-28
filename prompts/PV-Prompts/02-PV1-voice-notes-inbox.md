# BUILD ORDER 02 — PV1: Voice Notes Inbox

Use the existing destination architecture from PV2.

## Goal
Implement **PV1 — Voice Notes Inbox**.

Add a destination that saves the finalized Gemini 3.5 transcript as a personal synced note instead of inserting it into another application.

Reuse the existing Gemini transcription, Supabase auth, device IDs, current sync/service patterns, and RLS conventions.

Create the smallest necessary `voice_notes` schema:

```text
id
user_id
text
source_device_id
status
created_at
updated_at
```

Statuses can simply be `inbox` and `archived`.

Add a minimal Notes Inbox UI with create via dictation, copy, archive/unarchive, and delete. Add an obvious way to choose Voice Note as the current dictation destination.

Do not create tags, folders, summaries, tasks, embeddings, or AI analysis. Normal Active Field dictation must remain unchanged.

Test Windows/Android creation and cross-device loading. Run checks, report changes, and stop.
