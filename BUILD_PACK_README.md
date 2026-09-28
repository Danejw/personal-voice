# Personal Voice App — Cursor/Codex Build Pack

This folder is the source of truth for building the personal cross-device voice app.

## Product in one sentence

A single maintainable Windows + Android app where the user can press, speak, release, and have clean text inserted into the currently focused text field.

## V1

```text
Press → Speak → Release → Gemini transcription → Insert text
```

Targets:

- Windows first
- Android second
- One Tauri 2 codebase
- React + TypeScript shared UI/application logic
- Rust for the Tauri/native core
- Small Kotlin Tauri plugin only for Android-native services
- Gemini 3.5 Transcribe Live as the initial transcription provider
- Supabase only for authentication, small settings/dictionary sync, and secure Gemini token issuance
- No audio proxy through our backend
- No local transcription provider in V1
- No meeting recorder
- No assistant mode yet

## How to use this pack

Give `AGENTS.md`, `docs/SPEC.md`, and `docs/ARCHITECTURE.md` to Cursor/Codex as persistent project context.

Then run the implementation prompts in order:

```text
prompts/00-foundation.md
prompts/01-gemini-proof.md
prompts/02-windows-dictation.md
prompts/03-reliability.md
prompts/04-secure-backend.md
prompts/05-sync.md
prompts/06-android.md
prompts/07-packaging.md
prompts/08-updates.md
prompts/09-polish.md
prompts/10-v1-audit.md
```

Do not ask an agent to implement every phase in one pass.

Each phase should be completed, tested, and audited before continuing.

## Important API rule

Before implementing Gemini-specific network code, verify the current Google Gemini API documentation for:

- exact current transcription model ID
- Live/WebSocket endpoint
- ephemeral-token flow
- audio format requirements
- custom vocabulary field names
- Smart transcription configuration
- session duration/expiration behavior

The architecture in this pack should remain stable even if Google changes individual API field names.

## V1 definition of done

### Windows

```text
Hold configured hotkey
Speak
Release
Correct transcript appears in the focused text field
```

### Android

```text
Hold floating mic
Speak
Release
Correct transcript appears in the focused text field
```

Both devices share the same dictionary and core settings.
