# Phase 5 — Dictionary and Settings Sync

Read:

- `AGENTS.md`
- `docs/SPEC.md`
- `docs/BACKEND_SYNC.md`

## Goal

Give the user one shared personal vocabulary and core settings across devices.

## Implement

Supabase tables/RLS for:

- profiles if required
- devices
- dictionary
- settings

Use minimal schema.

Enable RLS so users can only access their own rows.

## Dictionary

Support:

- add term
- edit term if useful
- enable/disable term
- delete term
- load enabled terms when a transcription session is configured

Pass enabled terms through the current official Gemini custom-vocabulary mechanism.

Keep vocabulary curated.

## Settings

Sync only settings that truly belong across devices, such as:

- Smart transcription on/off
- language

Keep platform-specific settings such as a Windows hotkey local unless there is a clear reason to sync them.

## Sync behavior

Keep it simple:

```text
load on login/start
save on change
cache last-known values locally
```

No CRDT.
No elaborate real-time sync engine.

## Acceptance criteria

Changing the dictionary/settings persists to Supabase and reloads correctly after restart/login.

Gemini sessions receive the active custom vocabulary.

Windows dictation remains functional.

Stop after Phase 5.
