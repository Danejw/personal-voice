# Phase 4 — Secure Gemini Credentials

Read:

- `AGENTS.md`
- `docs/BACKEND_SYNC.md`
- current provider implementation

## Goal

Remove any permanent Gemini credential from the shipped client.

## First step

Verify Google's current official Live API client-authentication / ephemeral-token flow.

Do not assume old request fields.

## Implement

Use Supabase for:

- user authentication
- one secure backend/Edge Function that creates or obtains the short-lived Gemini client credential supported by the current API

Flow:

```text
authenticated client
→ Supabase function
→ server-side Google credential
→ short-lived Gemini credential
→ client connects directly to Gemini
```

Live microphone audio must not pass through Supabase.

## Security requirements

- server secret never returned
- server secret never logged
- token endpoint requires authenticated user
- short-lived credentials are cached/reused only within safe lifetime rules
- client gracefully renews expired credentials
- no permanent Gemini key remains in release configuration

Do not add dictionary/settings sync in this phase except schema scaffolding strictly required by auth.

## Acceptance criteria

Windows dictation still works end-to-end with no permanent Gemini credential embedded in the client.

Document:

- exact official token flow used
- token lifetime/renewal behavior
- environment variables/secrets required

Stop after Phase 4.
