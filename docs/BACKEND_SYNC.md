# Backend and Sync

## Goal

Keep the backend intentionally small.

It is not a transcription server.

## Use Supabase for

- authentication
- dictionary storage
- settings storage
- device metadata
- secure Google/Gemini credential handling
- short-lived client token issuance

## Do not use Supabase for

- audio proxying
- live transcription
- transcript processing
- job queues
- transcript analytics
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
updated_at timestamptz not null default now()
```

Keep device-specific settings local unless there is a concrete reason to sync them.

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
- RLS on all three tables, with one policy each: `to authenticated using/with check (user_id = (select auth.uid()))`. `anon` has no table privileges.
- Last write wins: the client sends the whole settings row on each change.

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
