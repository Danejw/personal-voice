# Assistant 03 — Interruption and session resilience

Prompt: `prompts/assistant-prompts/03-assistant-interruption-resilience.md`

Branch: `assistant`

## Phase goal

Make one Assistant conversation survive barge-in and a dropped Live socket:

```text
Gemini speaking
→ user interrupts
→ queued audio stops
→ stale model audio is dropped
→ the new user turn continues

GoAway or a recoverable disconnect
→ newest in-memory resumption handle
→ new Assistant token
→ same microphone, same on-screen turns
→ Listening again
```

Dictation stays on its own controller.

## Starting state that mattered

Phase 02 already streamed 16 kHz microphone audio, played 24 kHz replies, and cleared playback on `interrupted`. It still applied model audio and output transcription that arrived after that flag. `GoAway` and most socket closes ended the session and released the microphone. Setup did not send `contextWindowCompression` or `sessionResumption`. `DictationController` was left unchanged.

Checked against the Live session-management docs aligned with 2026-09-15. A connection lasts about 10 minutes and then sends `GoAway`. `sessionResumptionUpdate.newHandle` is stored only when `resumable` is true. `contextWindowCompression.slidingWindow` is `{}`. The handle is passed in client setup, not locked into the ephemeral token.

## What shipped

Barge-in follows the server `interrupted` event. Playback `clear()` stops queued sources immediately. Model audio and output transcription after that flag are ignored until the interrupted turn's `turnComplete`. The Assistant text already received is kept. The microphone stays open, so the new user transcript continues on the same socket. Audio that shares a message with `interrupted` can start and is then cleared. Later chunks before `turnComplete` are not played.

Setup now includes `contextWindowCompression: { slidingWindow: {} }` and `sessionResumption`. A new session sends `sessionResumption: {}`. A reconnect sends `{ handle }` with the newest handle that arrived with `resumable: true`. An update that is not resumable leaves the previous handle in place. Handles stay in memory. End and a failed resume drop the handle. A later Start is a new Gemini session and does not replay the transcript.

`GoAway` and a recoverable close after the socket is ready reconnect once. The controller takes a new assistant token (`uses: 1`), opens a new v1beta socket, and returns to Listening. Microphone capture and the lease stay with Assistant. Chunks that arrive while the new socket is connecting are buffered and flushed in order. The old socket's events are ignored through a connection id that is separate from the microphone generation. Queued playback is cleared. Committed turns stay on screen. A second immediate failure, a close `1007` or `1008`, or a drop with no handle fails clearly: the conversation was not resumed. User End does not reconnect.

Dev builds show a Reconnect button in the Assistant header while a session is running. It uses the same path. It does not display or log the handle or the token. With no handle yet, it fails with the same clear message.

## Files

- `src/assistant/protocol.ts` — compression, resumption setup, handle parsing
- `src/assistant/events.ts` — `goAway`, `disconnected`, `resumption`
- `src/assistant/AssistantSession.ts` — handle in setup; recoverable close is not a fatal error
- `src/assistant/AssistantController.ts` — barge-in boundary, reconnect, connection generation
- `src/assistant/state.ts` — reconnect keeps turns; status **Reconnecting…**
- `src/assistant/AssistantPanel.tsx` — dev-only Reconnect button
- `src/app/App.tsx` — session factory receives the handle
- `docs/ARCHITECTURE.md`, `docs/BACKEND_SYNC.md`

`DictationController` was not edited. The assistant token body was not changed.

## Model, API, and config

Same model and socket as phase 02: `gemini-3.8-live` on

`wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained`

Client setup adds:

```text
contextWindowCompression: { slidingWindow: {} }
sessionResumption: {}    or    { handle: <newest resumable handle> }
```

The token lock remains model, `AUDIO`, and both transcription configs. `sessionResumption` is intentionally absent from `liveConnectConstraints`, so each reconnect can pass a different handle. That assumes unspecified constraint fields still come from the client setup. If Google treats `config` as a full replacement, resumption would not work until the token changes. That was not verified against a live session.

`gemini-token` was not modified and was not deployed in this session. Phases 01 and 02 still require that function to be deployed for the assistant token lock.

## Schema

None.

## Platform behavior

Windows and Android both keep the existing `PlatformAdapter.createCapture()` path. Reconnect does not stop capture and does not open a second device. Android capture is still foreground-only. There is no floating Assistant control.

## Automated checks

`pnpm check` passed: lint, `tsc --noEmit`, 41 files, 265 tests.

`pnpm build` passed.

Covered: barge-in clears playback and drops stale model audio and transcription, resumption-handle parsing, reconnect with the newest handle, old-socket rejection, microphone audio flushed onto the new socket, GoAway with no handle, a refused close, one failed reconnect, context-window compression in setup, and the existing dictation and lease tests.

Not run: a live Gemini session, the manual interrupt-and-recall script, or a device pass on Windows or Android.

## Manual test

Deploy `supabase/functions/gemini-token` first if the phase 01–02 assistant lock is not already live. This phase does not change that request body.

Use a dev build so the Reconnect button is present. Production builds omit it.

1. Start Assistant and ask for a long explanation.
2. While Gemini is speaking, say: `Stop. Give me the answer in one sentence.`
3. Pass if the old audio stops promptly and Gemini answers the interruption.
4. Tell it a memorable fact.
5. Click **Reconnect**. Status should go to **Reconnecting…**, then **Listening**. The fact should still be on screen. The handle and token must not appear.
6. Ask it to recall the fact.
7. Pass if the context survives the reconnect.
8. End Assistant, then dictate: `This is a normal dictation regression test.` Pass if insert still behaves as before.

If Reconnect is pressed before any resumable handle has arrived, pass if the session fails with a message that the conversation could not be resumed.

## Known limitations

- Live speech, GoAway, and resumption were not verified against Gemini or on a device.
- The token-lock assumption above is untested. A live reconnect is the check.
- No Assistant hotkey, overlay Assistant mode, selection context, tools, Search, screenshots, saved memory, or remote context.
- The transcript and the handle are only in memory. End, a failed resume, or an app restart starts a fresh Gemini session. The transcript is not replayed into that session.
- The typed composer stays disabled while status is Responding. Barge-in is the voice `interrupted` path.
- Reconnect runs as soon as `GoAway` arrives. It does not wait out `timeLeft`.
- One reconnect is attempted. A second immediate failure ends the session.
- A reply that never starts within 45 seconds of a finished user turn still ends the session.
- Automatic VAD can treat speaker bleed as the user. Echo cancellation stays the existing capture setting.

## Next-phase boundary

Stop here. Do not add an Assistant hotkey, floating-control Assistant mode, selection context, tools, Search, screenshots, remote context, or memory.
