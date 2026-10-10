# Backend and Sync

Implementation notes for Personal Voice sync features (notes, handoffs, usage opt-out) are in [`docs/PV-Phases/`](PV-Phases/README.md).

## Goal

Keep the backend intentionally small.

It is not a transcription server.

## Use Supabase for

- authentication
- dictionary storage
- settings storage
- device metadata
- explicitly saved notes (voice, manual, or Assistant), with private file attachments
- explicitly sent device handoffs
- opt-in recent dictations (final text only, and only while the account setting is on)
- saved Assistant conversations (final or interrupted text, url/title citations, and a tool name plus outcome)
- secure Google/Gemini credential handling
- short-lived client token issuance

## Do not use Supabase for

- audio proxying
- live transcription
- transcript processing
- job queues
- transcript analytics or per-utterance logs
- automatic transcript history for accounts that have not opted in
- permanent recording storage
- Assistant resumption handles, raw microphone audio, or tool arguments that could be replayed

## Suggested tables

### profiles

```sql
id uuid primary key references auth.users(id)
created_at timestamptz not null default now()
```

### devices

```sql
id uuid primary key
user_id uuid not null references auth.users(id)
name text not null
platform text not null
last_seen timestamptz
created_at timestamptz not null default now()
```

### dictionary

```sql
id uuid primary key
user_id uuid not null references auth.users(id)
term text not null
enabled boolean not null default true
created_at timestamptz not null default now()
updated_at timestamptz not null default now()
```

Add a uniqueness constraint suitable for case behavior after deciding whether `Persyn` and `persyn` should be distinct.

### settings

Use one row per user.

Possible fields:

```sql
user_id uuid primary key references auth.users(id)
smart_transcription boolean not null default true
language text
usage_intelligence boolean not null default true
usage_epoch bigint not null default 0
cloud_dictation_history boolean not null default false
updated_at timestamptz not null default now()
```

`usage_epoch` is server-owned. A missing settings row means epoch 0. Ordinary settings saves omit it. A trigger ignores client changes. Only `clear_usage_analytics()` increments it.

Keep device-specific settings local unless there is a concrete reason to sync them.

Account-wide: Smart transcription, language, usage intelligence, and sync recent dictations.

Device (local, existing device ID): dictation destination, microphone, floating-control visibility, push-to-talk.

Local machine only: Windows launch at login; Android overlay, accessibility, floating-mic want/start-on-boot prefs, and live FGS.

### notes

Notes are explicitly saved items, regardless of whether they come from dictation, manual entry, or the Assistant. The canonical table is `public.notes`. `voice_notes` was a temporary compatibility view and has been removed:

```sql
id uuid primary key
user_id uuid not null references auth.users(id)
text text not null
source_device_id uuid not null
status text not null -- inbox | archived
created_at timestamptz not null
updated_at timestamptz not null
source_type text not null -- voice | manual | assistant
```

Note files of any MIME type use the private `note-attachments` bucket and the `note_attachments` metadata table. A single attachment is limited to 100 MB. Stored files require explicit user authorization before an Assistant upload.

### dictations

Recent dictations are opt-in. `settings.cloud_dictation_history` defaults to false. While it is on, each new finalized transcript is inserted here. Turning it off stops new uploads and does not delete existing rows. This is not an audio store and it is not filled unless the user opts in.

```sql
id uuid primary key
user_id uuid not null references auth.users(id)
text text not null
destination text not null -- active-field | voice-note | send-to-device
outcome text not null -- success | failure
source_device_id uuid not null
created_at timestamptz not null
```

### handoffs

Handoffs are intentional text transfers, not chat or transcript history:

```sql
id uuid primary key
user_id uuid not null references auth.users(id)
text text not null
source_device_id uuid not null
target_device_id uuid
created_at timestamptz not null
consumed_at timestamptz
```

A null target makes the handoff visible to all of the owner's other devices.

## RLS

Enable Row Level Security on all user-owned tables.

Users may only read/write rows where `user_id = auth.uid()`.

Do not depend solely on client filtering.

## Gemini token function

Create a single backend function responsible for converting the server-side Google credential into whatever short-lived client credential the current official Gemini Live API supports.

Responsibilities:

1. require authentication
2. validate caller
3. request/create short-lived Gemini credential
4. return only the minimum required data
5. never return the permanent server credential
6. avoid logging secrets

Keep this function provider-specific so future Google API changes do not affect the rest of the application.

As implemented: `supabase/functions/gemini-token`. It is deployed with gateway `verify_jwt` off, because Supabase's gateway can't verify requests made with the new publishable keys. Instead the function verifies the caller's access token itself, against the project JWKS (issuer `<SUPABASE_URL>/auth/v1`, audience `authenticated`). Any confirmed account may mint tokens; there is no email allowlist. See `docs/PHASE_4_REPORT.md` for the token flow and secrets.

A missing `purpose`, or `"dictation"`, still mints the Gemini 3.5 Transcribe Live token on `v1alpha`. `{ "purpose": "assistant" }` mints a `v1alpha` token locked to `gemini-3.8-live` (`fieldMask: "model"`). The client setup supplies `AUDIO`, transcription, resumption, and tools. Both purposes use the constrained v1alpha Live socket; v1beta constrained sessions closed with 1011 in practice. When a Live setup that includes Google Search is closed for quota, Assistant opens the same session again without Search. The permanent API key stays in the function. Tokens are not logged. The Assistant pipeline is summarized in [Assistant phases](Assistant-Phases/README.md).

Supervised screen clicks use a separate function, `supabase/functions/computer-step`. It calls the Interactions API as `gemini-3.8-flash` with the desktop Computer Use tool and prompt-injection detection. That function is not deployed. The Live token body does not include it.

## As implemented (Assistant device requests)

Migration `supabase/migrations/20260929020000_device_context_requests.sql` adds `device_context_requests` for a read-only look at another owned device. Migration `supabase/migrations/20260929030000_device_action_requests.sql` adds `device_action_requests` for an allowlisted remote action (`open_app`, `press_shortcut`, or `insert_text`). Both tables use owner-only RLS (`user_id = auth.uid()`). Neither grants a shell. Rows are deleted after the requester finishes with them. A continuation package stays in the existing `handoffs.text` column and is not a new table.

## As implemented (Phase 5)

Migration `supabase/migrations/20260927230000_personal_sync.sql` (applied as `personal_sync`):

- `devices`, `dictionary`, and `settings` as above. `user_id` defaults to `auth.uid()` and cascades on user deletion.
- No `profiles` table. Nothing needs per-user data beyond `auth.users`.
- Dictionary terms are unique per user **case-insensitively** (`Persyn` and `persyn` are the same term), must be trimmed, and are 1–100 characters. A trigger caps each user at 200 terms. The client also keeps at most 100 terms *active*, matching Gemini's recommended vocabulary size.
- `settings.language` is a BCP-47 code or `null` (automatic detection).
- PV17 adds `settings.usage_intelligence` (default true).
- Personal analytics adds `settings.usage_epoch` and `usage_days`. Clients may select their own days. Insert, update, and delete are revoked. `upsert_usage_day()` and `clear_usage_analytics()` are security definer and hold the same per-user advisory lock. A missing settings row is epoch 0; clear creates that row, then increments the epoch and deletes the days in one transaction. `saveSettings` does not send `usage_epoch`.
- RLS on all three tables, with one policy each: `to authenticated using/with check (user_id = (select auth.uid()))`. `anon` has no table privileges.
- Last write wins: the client sends the whole settings row on each change.

## Notes history (original PV1 implementation)

Historically, migration `supabase/migrations/20260928133000_voice_notes.sql` added `voice_notes` with the same
per-user RLS convention as the original sync tables. It was later renamed to `notes`; the backward-compatibility view was removed by `20261010010000_remove_legacy_voice_notes_view.sql`. `source_device_id` uses the app's existing
stable per-account device ID. It intentionally has no foreign key because device registration is
best-effort and must not race note creation on a new install.

The current `NotesStore` loads on sign-in and refreshes when the app becomes visible. Create, archive,
restore, and delete are online operations; a failed destination save leaves the finalized
transcript visible in the dictation error state.

## As implemented (PV3 Device Handoff)

Migration `supabase/migrations/20260928135000_handoffs.sql` adds `handoffs` with owner-only RLS.
Source and target IDs reuse the stable per-account device IDs but intentionally have no foreign
keys, because device registration is best-effort. The receiver query excludes the source device
and returns only pending rows targeted to the current device or to all devices.

`HandoffStore` supports typed sends and the Send to Device dictation destination. It refreshes on
sign-in, focus, visibility, explicit request, and about every 8 seconds while signed in, including
when Settings is hidden in the tray. The first successful load does not alert. Later pending rows
for this device show a Windows toast (sending device name and a short preview). Clicking the toast
inserts the text and does not open Settings or consume the row. Copy and insert do not consume a
row; Dismiss sets `consumed_at`, allowing the user to confirm the transfer before removing it.

PV4 exposes the typed-send path as Shared clipboard in the UI and reuses the same target
selection as Voice handoff. It does not add a table, read the OS clipboard, or monitor clipboard
changes. A refresh replaces the current result set rather than appending to it, while every
explicit send creates its own row even when the text matches an earlier send.

## As implemented (PV12 Device management)

The existing `devices` table is the only device record. `DeviceStore` lists every owned install,
including the current one. Rename updates `name` (1–100 characters after trim). Remove deletes
the device row and is refused for the current install. `source_device_id` / `target_device_id`
on notes and handoffs are intentionally not foreign keys, so a removed device cannot cascade
into those tables.

## As implemented (PV11 Device preferences)

No new migration. Device preferences stay in the client under `device.prefs.<device id>`:
destination, microphone, floating-control visibility, and push-to-talk. They are not columns on `settings`
or `devices`. Account transcription settings continue to sync; Windows-only values cannot
reach Android because each OS has its own WebView storage.

## As implemented (PV17 Usage intelligence)

Migration `supabase/migrations/20260928160000_usage_intelligence.sql` adds
`settings.usage_intelligence`. The original counters lived in `usage.totals.v1`. Personal
analytics supersedes that store. If the old blob is still present it is shown separately
and is not copied into a daily row.

## As implemented (Personal analytics)

Migration `supabase/migrations/20260928230000_usage_days.sql` adds `settings.usage_epoch`
(default 0) and `usage_days` (`user_id`, `device_id`, `day`, `epoch`, `counters`, `revision`).
The primary key is one row per user, device, and local day. Authenticated clients have
`SELECT` only. `upsert_usage_day()` locks the user, treats a missing settings row as epoch 0,
and updates only when the incoming revision is greater and the epoch matches.
`clear_usage_analytics()` locks the same user, inserts a settings row when one is missing,
increments the epoch, and deletes `usage_days` before returning the new epoch. Counters are
aggregates (`counters.version` 1). They do not include transcript text or audio.

The client pages `usage_days` (1000 rows, day descending, then device id). Lifetime totals
and streaks read every page. Month, last-14-day, and week panels request only those ranges.
This device's local day replaces the matching remote row. After a successful upsert, clean
local days beyond the newest 90 are dropped. Dirty days stay until they ack.

## Sync behavior

V1 can be simple:

### On login/start

Fetch:

```text
settings
dictionary
```

### On edit

1. update local UI immediately
2. write to Supabase
3. report sync errors without blocking dictation

No conflict-resolution engine is required for V1.

Last-write-wins with timestamps is acceptable for one personal user.

## Offline behavior

The app should still open and use its last cached settings/dictionary.

Cloud mutations can queue locally until connectivity returns if easy to implement, but do not build a complex offline database in early phases.

## Secrets

Store server secrets only in backend secret management.

Never commit:

```text
Gemini permanent API key
Supabase service role key
signing private keys
```

Client-side Supabase public/anon configuration may be included where appropriate.
