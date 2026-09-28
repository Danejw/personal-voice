# Phase 4 implementation report — secure Gemini credentials

## Scope

Only `prompts/04-secure-backend.md`: Supabase sign-in, one Edge Function that mints short-lived Gemini credentials, and a client that connects directly to Gemini with them. No dictionary or settings sync, and no database tables, since auth needed no schema.

## Official token flow used

Verified on 2026-09-27 against [Ephemeral tokens](https://ai.google.dev/gemini-api/docs/ephemeral-tokens), the [Live API reference](https://ai.google.dev/api/live#ephemeral-auth-tokens), and the request converter in Google's `@google/genai` SDK source (the docs show only SDK calls, not the REST body).

1. The client signs in to Supabase (email and password).
2. The client calls `POST <SUPABASE_URL>/functions/v1/gemini-token` with `Authorization: Bearer <user access token>`.
3. The function verifies the user's access token, then calls `POST https://generativelanguage.googleapis.com/v1alpha/auth_tokens` with header `x-goog-api-key: <GEMINI_API_KEY>` and body:
   ```json
   { "uses": 1, "expireTime": "<now+15m>", "newSessionExpireTime": "<now+2m>",
     "bidiGenerateContentSetup": { "model": "models/gemini-3.5-transcribe-live" }, "fieldMask": "model" }
   ```
   The token is locked to the transcription model only. The client still sends its own transcription settings, which Phase 5 will need for vocabulary.
4. The function returns only `{ token, newSessionExpireTime, expireTime }`, with `Cache-Control: no-store`.
5. The client opens `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained?access_token=<token>` and streams audio directly to Gemini. Audio never passes through Supabase.

Deviation from the Phase 3 design: Google documents ephemeral tokens as **Live API only**. The Phase 3 recovery path (unary `generateContent`) would have needed a permanent key on the client, so recovery now replays the buffered utterance into a fresh Live session with a new token.

## Token lifetime and renewal

| Rule | Value |
| --- | --- |
| Uses per token | 1: one Live session, and every utterance opens its own session |
| New-session window | 2 minutes from minting |
| Message lifetime (`expireTime`) | 15 minutes. That covers a token used at the end of its 2-minute window, a 5-minute utterance, and replay recovery (which gets its own token). |
| Client cache | At most one unused token, in memory only. It is handed out only if its new-session window has more than 15 s left; otherwise a fresh one is fetched. |
| Prefetch | On sign-in and after each token is used, so a press rarely waits on the round trip. Audio is buffered while connecting, so a slow fetch loses no speech. |
| Sign-out | The cached token is dropped. |
| Supabase session | `supabase-js` refreshes the access token automatically. `getSession()` is called before each token fetch. |
| Failures | 401 (signed out) → non-retryable ERROR with the server's message. Network or 5xx → retryable, so recovery tries once more with a new token before ERROR. |

## Environment variables and secrets

| Name | Where | Notes |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | Client `.env.local` | Client-safe. Template in `.env.example`. |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Client `.env.local` | Client-safe publishable key. |
| `GEMINI_API_KEY` | Supabase → Edge Functions → Secrets | Permanent key. Server only. |
| `SUPABASE_URL` | Provided by the Edge runtime | Used for JWKS verification. |

## Changes

- `supabase/functions/gemini-token/index.ts`: the token function, deployed to project `dlovrtlkniolcovfgvvj` (version 2, `verify_jwt: false`). It verifies the user JWT with `jose` `6.2.12` against the project JWKS. The project uses ES256 signing keys, and Supabase's gateway can't verify requests made with publishable keys. It logs only status codes, never keys, tokens, or Google response bodies.
- `src/services/supabase.ts`: lazy Supabase client (`@supabase/supabase-js` `2.58.0`, already pinned).
- `src/services/geminiTokenService.ts`: calls the function and maps responses to `CredentialError(message, retryable)`.
- `src/auth/useAuth.ts`, `src/auth/AuthPanel.tsx`: sign in, create account, sign out.
- `src/voice/provider/gemini/GeminiTokenSource.ts`: single-use token cache.
- `src/voice/provider/gemini/GeminiProvider.ts`:
  - The constructor takes a token source instead of an API key.
  - Sessions use the constrained v1alpha endpoint.
  - `transcribeRecording` replays the buffer in 0.5 s messages, throttled by the socket send buffer.
  - Tokens are redacted from close reasons like keys are.
  - The dev-key path and the unary recovery call are removed.
- `src/voice/audio/pcm.ts`: `encodeWav` removed (unused).
- `src/voice/session/DictationController.ts`: the recovery timeout is now 30 s plus the utterance's duration, since replay may run near real time.
- `src/app/App.tsx`, `app.css`:
  - An Account section replaces the dev-key field.
  - Dictation now works in release builds (it was DEV-only).
  - A token is prefetched on sign-in.
- `src-tauri/tauri.conf.json`:
  - The release CSP now allows the Gemini WebSocket and the Supabase URL.
  - The dev CSP drops the unused HTTPS Gemini origin.
- `.env.example`, and updates to `docs/ARCHITECTURE.md` and `docs/BACKEND_SYNC.md`.

## Checks

| Check | Result |
| --- | --- |
| `pnpm lint`, `pnpm typecheck` | PASS |
| `pnpm test` | PASS, 7 files / 61 tests (new: token cache, token response mapping, constrained endpoint, credential failures, replay recovery, abort) |
| `pnpm build` | PASS. Bundle scan finds no key-shaped strings; the only `AIza` match is the redaction regex. |
| `cargo clippy --all-targets -D warnings` | PASS |
| Deployed function, no `Authorization` | 401 |
| Deployed function, forged JWT | 401 |
| Deployed function, publishable key as bearer | 401 |
| CORS preflight | 204 |

## Not yet verified (needs your setup)

A real token has not been minted yet, because `GEMINI_API_KEY` isn't set. So the following are still unconfirmed live:

- that Google accepts the REST body above;
- that the constrained endpoint accepts the token with this model;
- that fast replay recovery is accepted.

Phase 4 is **not complete** until end-to-end dictation passes.

## Known limitations

- **Open sign-up, shared quota:** by the user's choice (2026-09-27), any confirmed account can mint Gemini tokens. The email allowlist (`ALLOWED_EMAILS`) was removed. Every account uses the project's Gemini key and quota, and there is no per-user rate limit. To restrict access later, turn off sign-ups in Supabase Auth, or add a check back in the function.
- **Email confirmation link:** it redirects to the project's Site URL (default `http://localhost:3000`). The page may not load, but the account is confirmed.
- **Replay speed:** it is limited by Gemini's processing. A long recovered utterance can take up to about its own length.
- **Empty `supabase/functions/gemini-recover`:** created outside this phase and left untouched. A recovery function that received audio would break the "no audio through the backend" rule, so it should stay unused.
