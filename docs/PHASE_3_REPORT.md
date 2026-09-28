# Phase 3 implementation report — reliability

## Scope

Only `prompts/03-reliability.md`: a temporary per-utterance audio buffer, same-provider recovery, explicit per-utterance state, and the listed failure cases. No Supabase, token backend, sync, Android, or additional providers.

## Changes

- `voice/audio/pcm.ts`: `concatPcm`, `encodeWav`, `PCM_BYTES_PER_MS`.
- `voice/provider/VoiceProvider.ts`:
  - `error` events now carry `retryable`.
  - New optional `transcribeRecording(pcm, signal)`: non-streaming transcription of a buffered utterance by the same provider.
- `voice/provider/gemini/GeminiProvider.ts`:
  - Errors are classified. WebSocket close codes 1007/1008 and a server `error` message are non-retryable. Network errors, unexpected closes, connect/final timeouts, `goAway`, unreadable frames, and send congestion are retryable.
  - `transcribeRecording` POSTs inline WAV to `v1beta/models/gemini-3.5-transcribe:generateContent` with `audioTranscriptionConfig`, which uses the same SMART/VERBATIM mode, language codes, and vocabulary as the live session. The key is sent in the `x-goog-api-key` header, never in a URL. HTTP failures map to short user-facing messages.
  - The 5-minute proof timer moved to the controller. The final-transcript wait dropped from 20 s to 10 s, because recovery now follows. Base64 encoding is chunked so large buffers don't overflow the call stack.
- `voice/session/state.ts`: `finish` is allowed from CONNECTING, so releasing before the connection is ready goes straight to FINALIZING.
- `voice/session/DictationController.ts`: rewritten around a per-utterance object. The old controller-wide `pending` and `stopRequested` flags are gone. See the "Failure recovery" section of `docs/ARCHITECTURE.md`. Limits (minimum tap length, maximum length, connect grace, recovery timeout) are constructor options, so tests can shorten them.
- `app/App.tsx`: the status line now says "Microphone active" during CONNECTING too, since audio is already being captured and buffered then.
- `src-tauri/tauri.conf.json`: dev CSP allows `https://generativelanguage.googleapis.com` for the recovery call.

## Failure handling

| Case | Behavior |
| --- | --- |
| Gemini connection fails (retryable) | Recording continues. On release the buffered audio is transcribed by the recovery call. |
| Connection drops mid-utterance | Same: the full buffer from the start of the press is recovered. The dropped session is closed and its late events are ignored. |
| Still connecting when released | FINALIZING right away. Waits up to 2 s for the live session, then recovers. |
| No final after release (10 s) | Recovery. |
| Expired session (`goAway`) | Recovery. |
| Invalid key / refused config | ERROR immediately with a clear message. No recovery, since it would fail the same way. |
| Recovery fails or takes over 30 s | ERROR. The next press starts clean. |
| Microphone unavailable or lost | ERROR with the microphone message. The session is closed. |
| Empty transcript (live or recovery) | Back to IDLE, nothing inserted. |
| Duplicate final | Only the first final answering end-of-speech is delivered. The utterance is released at that moment, so later events have no target. |
| Quick press/release (< 250 ms of audio) | Discarded silently: back to IDLE, no transcription, no insert. |
| Held longer than 5 minutes | Auto-stops and transcribes. |
| Cancel (Escape or tray pause) at any point before insertion | IDLE. A pending recovery is aborted, and its result is dropped even if it arrives later. |
| Focus change while speaking | Unchanged from Phase 2: the text goes to whatever is focused at insertion time. |
| Insertion fails | ERROR, with the transcript left visible in Settings. |

The audio buffer lives only in memory, inside the utterance object. It is cleared on insert, cancel, or failure, and is never persisted or synced.

## Required tests

| Requirement | Test(s) in `DictationController.test.ts` |
| --- | --- |
| One final inserts once | "inserts once even when the provider repeats the final"; the recovery tests assert a single insert |
| Duplicate finals ignored | "ignores duplicate and late final events" |
| Cancellation never inserts | "cancel abandons the utterance…", "cancel during recovery aborts it and never inserts" |
| Error returns to a usable state | "moves non-retryable provider errors into ERROR…", "returns to a usable ERROR when recovery fails…", "times out a stuck recovery" |
| Next utterance unaffected by a previous failure | "returns to a usable ERROR when recovery fails, and the next utterance is unaffected", "keeps the transcript visible when insertion fails, and the next utterance still works", "press starts a fresh utterance after an error" |
| Retry cannot insert stale output | "a stale recovery result cannot insert into a later utterance", "does not let a stale session's final insert into the next utterance" |

The recovery paths have their own tests: mid-utterance drop, connect failure, final timeout, connect grace timeout, and empty result. So do the limits (quick tap, maximum length). `GeminiProvider.test.ts` covers error classification, the final timeout, the recovery request shape (key in a header, not the URL), response parsing, and HTTP/network error messages. `pcm.test.ts` covers PCM encoding, concatenation, and the WAV header.

## Checks

| Command | Result |
| --- | --- |
| `pnpm lint`, `pnpm typecheck` | PASS |
| `pnpm test` | PASS, 5 files / 52 tests |
| `pnpm build` | PASS |
| `cargo fmt --check`, `cargo clippy --all-targets -D warnings`, `cargo test` | PASS (Rust unchanged; only the known exFAT cache notice) |

## Manual tests (user, 2026-09-27)

The user ran the manual checklist with the dev key and reported all checks as passing. Results were reported as a whole, not item by item.

| Check | Result |
| --- | --- |
| Normal dictation still works as in Phase 2 | PASS |
| Wi-Fi off and back on mid-utterance, then release: whole utterance inserted once | PASS |
| Very brief tap: nothing happens | PASS |
| Wrong API key: immediate error; next press after fixing the key works | PASS |
| Escape during "Finishing…": nothing inserted | PASS |

Phase 4 later replaced the unary recovery call with a Live replay, because ephemeral tokens are Live-only. See `docs/PHASE_4_REPORT.md`.

## Known limitations and Phase 4 note

- **Phase 4 credential path:** Gemini ephemeral tokens are currently Live-API-only. The recovery call uses the dev key today. Phase 4 must give recovery a credential without shipping a permanent key: either confirm ephemeral tokens work for `generateContent`, or have the token function mint something that does. Audio still must not be proxied through the backend.
- **Press while finishing:** a new press while an utterance is finalizing or recovering is still ignored (same as Phase 2). Queuing it was not needed for the acceptance criteria.
- **Recovery waits for release:** if the connection drops mid-utterance, there are no live partials for the rest of that utterance. The text appears after release.
- **Recovery size:** 5 minutes of 16 kHz PCM is about 9.6 MB (about 12.8 MB base64), which is under the 20 MB inline request limit.
