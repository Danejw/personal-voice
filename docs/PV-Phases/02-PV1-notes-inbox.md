# PV1 implementation report — notes inbox

Prompt: `prompts/PV-Prompts/Done/02-PV1-notes-inbox.md`

## Scope

Add a dictation destination that saves the finalized transcript as a synced note instead of inserting it. Reuse Gemini, auth, device ids, and RLS. No tags, folders, summaries, or AI analysis.

**Historical phase report.** PV1 originally created a `voice_notes` table. The current canonical table is `public.notes`, the legacy view was retired, and the current implementation uses `NotesStore` and `NotesPanel`. The `voice-note` destination ID remains a compatibility value, not a second notes table.

## Database

Migration `supabase/migrations/20260928133000_voice_notes.sql` (applied on project `dlovrtlkniolcovfgvvj`):

| Column | Role |
| --- | --- |
| `id` | Primary key |
| `user_id` | Owner; RLS `auth.uid()` |
| `text` | Note body (final transcript only) |
| `source_device_id` | Existing per-account device id; **no FK** to `devices` |
| `status` | `inbox` or `archived` |
| `created_at` / `updated_at` | Timestamps |

`source_device_id` has no foreign key because device registration is best-effort and must not race the first note on a new install.

## What shipped

- Destination id `voice-note` on the router; save waits for Supabase to confirm the insert.
- `NotesStore` / `NotesPanel`: load on sign-in, refresh when Settings becomes visible; copy, archive/unarchive, delete.
- Failed save is a destination failure: dictation goes to `ERROR`, transcript stays visible.

## Deviations

Notes are online-only. There is no offline create queue (out of scope; that is later PV29).

## Checks

`src/notes/NotesStore.test.ts` covers create, archive, and failure. Lint/typecheck/test passed in-session. Live Windows↔Android load was requested by the prompt; treat a two-device inbox refresh as a manual smoke if it has not been run on your machines.

## How to confirm quickly

Sign in → **Send transcript to** = Note → dictate → **Notes inbox** shows the text → Archive → Move to inbox → Copy → Delete. On a second signed-in device, focus Settings; the note should appear without realtime sockets.
