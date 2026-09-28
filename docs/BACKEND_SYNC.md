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
- explicitly saved voice notes
- explicitly sent device handoffs
- secure Google/Gemini credential handling
- short-lived client token issuance

## Do not use Supabase for

- audio proxying
- live transcription
- transcript processing
- job queues
- transcript analytics
- recent dictation history
- usage intelligence counters
- permanent recording storage

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
updated_at timestamptz not null default now()
```

Keep device-specific settings local unless there is a concrete reason to sync them.

Account-wide: Smart transcription, language, and usage intelligence.

Device (local, existing device ID): dictation destination, microphone, floating-control visibility, push-to-talk.

Local machine only: Windows launch at login; Android overlay, accessibility, and floating mic runtime.

### voice_notes

Voice notes are explicitly saved dictation destinations, not automatic transcript history:

```sql
id uuid primary key
user_id uuid not null references auth.users(id)
text text not null
source_device_id uuid not null
status text not null -- inbox | archived
created_at timestamptz not null
updated_at timestamptz not null
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

## As implemented (Phase 5)

Migration `supabase/migrations/20260927230000_personal_sync.sql` (applied as `personal_sync`):

- `devices`, `dictionary`, and `settings` as above. `user_id` defaults to `auth.uid()` and cascades on user deletion.
- No `profiles` table. Nothing needs per-user data beyond `auth.users`.
- Dictionary terms are unique per user **case-insensitively** (`Persyn` and `persyn` are the same term), must be trimmed, and are 1–100 characters. A trigger caps each user at 200 terms. The client also keeps at most 100 terms *active*, matching Gemini's recommended vocabulary size.
- `settings.language` is a BCP-47 code or `null` (automatic detection).
- PV17 adds `settings.usage_intelligence` (default true). Usage counters stay in local WebView storage and are never written to Supabase.
- RLS on all three tables, with one policy each: `to authenticated using/with check (user_id = (select auth.uid()))`. `anon` has no table privileges.
- Last write wins: the client sends the whole settings row on each change.

## As implemented (PV1 Voice Notes)

Migration `supabase/migrations/20260928133000_voice_notes.sql` adds `voice_notes` with the same
per-user RLS convention as the original sync tables. `source_device_id` uses the app's existing
stable per-account device ID. It intentionally has no foreign key because device registration is
best-effort and must not race note creation on a new install.

`VoiceNotesStore` loads on sign-in and refreshes when the app becomes visible. Create, archive,
restore, and delete are online operations; a failed destination save leaves the finalized
transcript visible in the dictation error state.

## As implemented (PV3 Device Handoff)

Migration `supabase/migrations/20260928135000_handoffs.sql` adds `handoffs` with owner-only RLS.
Source and target IDs reuse the stable per-account device IDs but intentionally have no foreign
keys, because device registration is best-effort. The receiver query excludes the source device
and returns only pending rows targeted to the current device or to all devices.

`HandoffStore` supports typed sends and the Send to Device dictation destination. It refreshes on
sign-in, focus, visibility, or explicit request. Copy and insert do not consume a row; Dismiss
sets `consumed_at`, allowing the user to confirm the transfer before removing it.

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
`settings.usage_intelligence`. The client stores only counters (event name, platform,
destination id, duration) in `usage.totals.v1`. Transcript text and audio are excluded from
the type and from persistence.

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
