# Assistant 01 — Gemini 3.8 Live foundation

Prompt: `prompts/assistant-prompts/01-assistant-live-foundation.md`

Branch: `assistant`

## Phase goal

Prove a typed Assistant session that is separate from dictation:

```text
Assistant page
→ Start
→ authenticated short-lived Gemini token
→ Gemini 3.8 Live
→ typed user turn
→ native spoken response
→ readable output transcription
→ second turn on same session
→ End
```

No Assistant microphone.

## Starting state that mattered

- Working branch was already `assistant`. Dictation used `GeminiProvider` and `DictationController` with `gemini-3.5-transcribe-live` on the constrained v1alpha Live socket.
- `gemini-token` minted only that transcribe token. The client posted with no body.
- There was no `src/assistant/` tree and no `docs/Assistant-Phases/` reports.
- Navigation was Voice, Devices & Controls, Settings, and Analytics.

## What shipped

```text
Dictation → Gemini 3.5 Transcribe Live → DictationController
Assistant → Gemini 3.8 Live → AssistantController
```

Assistant lifecycle:

```text
IDLE → CONNECTING → READY → RESPONDING → READY
                         ↘ ERROR
```

`End` returns to `IDLE`, stops playback, and ignores later events from that socket. A new `Start` opens a new session. The previous socket cannot update the screen.

A typed turn is `clientContent` with `turnComplete: true` on the open socket. The reply is PCM16 audio plus `outputTranscription`. The conversation stays in memory in `AssistantController`. It is not written to Supabase or disk.

## Files

- `src/assistant/protocol.ts` — setup message, typed turn, server-message parsing, base64, PCM16 alignment, secret redaction
- `src/assistant/AssistantSession.ts` — one constrained v1beta Live socket
- `src/assistant/AssistantController.ts` — lifecycle, second turn, end, stale-event rejection, response timeout
- `src/assistant/state.ts` — reducer
- `src/assistant/PcmPlayback.ts` — ordered Web Audio playback
- `src/assistant/AssistantPanel.tsx` — page
- `src/assistant/useAssistant.ts`
- `src/services/geminiTokenRequest.ts` and the identical copy `supabase/functions/gemini-token/tokenRequest.ts`
- `supabase/functions/gemini-token/index.ts` — reads `purpose`
- `src/services/geminiTokenService.ts` — assistant requests send `{ "purpose": "assistant" }`; dictation still sends no body
- `src/app/AppNav.tsx`, `src/app/App.tsx`, `src/app/app.css` — Assistant is a top-level destination
- `docs/ARCHITECTURE.md`, `docs/BACKEND_SYNC.md` — the new boundary and token purpose

`DictationController` and `GeminiProvider` were not changed.

## Model, API, and config

Checked against Google docs last updated 2026-09-15:

- https://ai.google.dev/gemini-api/docs/models/gemini-3.8-live
- https://ai.google.dev/gemini-api/docs/live-api/ephemeral-tokens
- https://ai.google.dev/gemini-api/docs/live-api/get-started-websocket
- https://ai.google.dev/gemini-api/docs/live-api/capabilities

| | Dictation (unchanged) | Assistant |
| --- | --- | --- |
| Client body | none | `{ "purpose": "assistant" }` |
| Token URL | `POST /v1alpha/auth_tokens` | `POST /v1beta/auth_tokens` |
| Lock | `bidiGenerateContentSetup.model` = `models/gemini-3.5-transcribe-live`, `fieldMask` `model` | `liveConnectConstraints.model` = `models/gemini-3.8-live`, `responseModalities` `AUDIO`, `outputAudioTranscription` `{}` |
| Socket | v1alpha `BidiGenerateContentConstrained` | v1beta `BidiGenerateContentConstrained` |
| Auth | `access_token` query param | same |
| New-session window | 2 minutes | 2 minutes |
| Token lifetime | 15 minutes | 30 minutes |
| Uses | 1 | 1 |

Assistant setup on the socket matches the lock: model `models/gemini-3.8-live`, `responseModalities: ["AUDIO"]`, `outputAudioTranscription: {}`. Output audio is little-endian PCM16 mono at 24 kHz. `thinkingLevel`, affective dialogue, and `proactiveAudio: false` are not sent. Gemini 3.8 Live rejects `proactiveAudio: false`.

Typed text uses `clientContent`, not `realtimeInput.text` and not `generateContent`. On this model, `clientContent` is valid for the whole session, and `turnComplete: true` starts the reply. `realtimeInput.text` does not mark the end of a typed turn.

The permanent `GEMINI_API_KEY` stays in the Edge Function. The function logs status codes only. Client errors redact `auth_tokens/…` and API-key-shaped strings.

## Schema

None.

## Platform behavior

One implementation for Windows and Android: WebSocket plus Web Audio in the existing Tauri webview. `Start Assistant` creates the audio context in that click so later chunks can play. Playback failures are swallowed. Audio is not written to disk. No new native plugin.

## Automated checks

`pnpm check` (lint, `tsc --noEmit`, vitest) passed: 40 files, 246 tests.

`pnpm build` (typecheck + Vite production build) passed.

Covered:

- missing or `"dictation"` purpose still builds the v1alpha transcribe token
- `"assistant"` builds the locked v1beta 3.8 Live token
- the Deno copy matches the tested module
- dictation fetch still has no body; assistant fetch sends only `{ "purpose": "assistant" }`
- setup message, typed turn, output transcription ordering, PCM split across chunks, secret redaction
- lifecycle, second turn on one session, End dropping an unfinished reply, stale events after End or replacement
- 24 kHz chunk order and immediate stop
- existing dictation tests, unchanged

## Manual test

Not run in this session. It needs a signed-in app and a deployed `gemini-token` function. The function source is updated locally and was not deployed.

1. Deploy `supabase/functions/gemini-token` before testing. Until then, Assistant Start fails at the token service, and dictation keeps working against the already deployed function.
2. Sign in and open **Assistant**.
3. Click **Start Assistant**. Status should become **Ready**.
4. Type: `Reply with exactly: Assistant online.` and Send.
5. Pass if audio plays, the readable reply appears, and status returns to **Ready**.
6. Without ending, type: `What exact phrase did I ask you to say in my previous message?`
7. Pass if the reply shows it remembers that turn.
8. Click **End Assistant**. Pass if audio stops and a late transcript does not appear.
9. Dictate: `This is a normal dictation regression test.`
10. Pass if Gemini 3.5 Transcribe still inserts that text as before.

## Known limitations

- The Edge Function change is not deployed, so a running app still has the previous token function until deploy.
- No Assistant microphone, barge-in control, shortcut, selection context, tools, Search, screenshots, saved memory, cross-device Assistant, or computer control.
- If the server sends `interrupted`, queued audio is cleared. There is no user-interruption feature.
- A tool call fails the session. Tools are not implemented.
- The in-memory transcript is not sent again after End. A new Start is a new Gemini session, so the model does not remember the previous one.
- Sessions are not resumed. The assistant token lasts 30 minutes and must open its socket within 2 minutes.
- A transcript chunk that arrives only after `turnComplete` is ignored. Google documents the last output transcription as arriving before that flag. Chunks in the same message are applied first.
- If no audio or transcript arrives for 45 seconds during a reply, the session goes to error.
- Live audio was not played against Gemini in this session. Playback was tested with a fake audio context.

## Next-phase boundary

Stop here. Do not add an Assistant microphone or any of the items in Known limitations that are listed as unbuilt product features.
