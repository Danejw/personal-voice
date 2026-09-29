# Assistant 02 — Live microphone conversation

Prompt: `prompts/assistant-prompts/02-assistant-live-voice.md`

Branch: `assistant`

## Phase goal

Turn the typed Gemini 3.8 Live session into a spoken conversation on the same socket:

```text
Start Assistant
→ speak
→ user transcript
→ Gemini speaks back
→ Assistant transcript
→ keep talking in the same session
```

Typed messages from phase 01 stay. Dictation stays on its own controller.

## Starting state that mattered

Phase 01 already had Assistant navigation, a v1beta token locked to `gemini-3.8-live`, typed `clientContent` turns, 24 kHz playback, and an in-memory conversation. The microphone was not used. Capture already produces PCM16 mono at 16 kHz in 100 ms chunks (`PCM_CHUNK_SAMPLES` 1,600) on Windows Web Audio and Android `AudioRecord`. `DictationController` was left unchanged.

## What shipped

Start claims the microphone, opens one Live session, and starts the existing capture inside that click. Chunks wait in memory only until setup completes, then go out in order as `realtimeInput.audio` with `audio/pcm;rate=16000`. Nothing is written to disk. The pending list is dropped after it is sent, and End clears it.

Automatic voice activity detection stays at the Live default. Setup does not disable it and does not send `activityStart` / `activityEnd`.

`inputAudioTranscription` is on. Interim text replaces the live "You" line. A finished input transcript becomes a user turn. Model audio still plays at 24 kHz, and `outputTranscription` becomes the Assistant turn. The microphone stays open, so the next utterance uses the same socket. End stops capture and playback and ignores later audio.

Typed send still works while status is Listening.

Microphone rule: `MicrophoneLease` in `src/voice/audio/microphoneLease.ts`. Assistant claims `assistant` for the whole session. Dictation capture goes through `gateDictationCapture`, which claims `dictation` and refuses to open the device while Assistant holds it. The same lease blocks the dictation button, the push-to-talk press, and the overlay dictate actions. `DictationController` itself was not edited.

While the model is speaking, a server `interrupted` event stops playback and keeps the Assistant text already received. That is the API's automatic barge-in signal, not a new interruption feature.

## Files

- `src/assistant/protocol.ts` — input transcription, 16 kHz audio chunk, setup
- `src/assistant/AssistantSession.ts` — `sendAudio`
- `src/assistant/AssistantController.ts` — capture, forwarding, End, lease
- `src/assistant/state.ts` — user transcript and Listening
- `src/assistant/AssistantPanel.tsx` — live user line; Start disabled while dictation is recording
- `src/voice/audio/microphoneLease.ts`
- `src/voice/audio/gateDictationCapture.ts`
- `src/app/useDictation.ts`, `src/overlay/useOverlay.ts`, `src/app/App.tsx` — shared lease at the call sites
- `src/services/geminiTokenRequest.ts` and `supabase/functions/gemini-token/tokenRequest.ts` — assistant token also locks `inputAudioTranscription`
- `docs/ARCHITECTURE.md`, `docs/BACKEND_SYNC.md`

## Model, API, and config

Same socket and model as phase 01. Checked against the Live docs updated 2026-09-15, including the capabilities page: automatic VAD is the default, input audio is 16-bit PCM at 16 kHz, and output is 24 kHz. Chunks stay the existing ~100 ms capture size, inside the documented 20–100 ms range.

Setup adds `inputAudioTranscription: {}`. The assistant ephemeral token's `liveConnectConstraints.config` now includes that field next to `responseModalities: ["AUDIO"]` and `outputAudioTranscription`. Dictation's v1alpha transcribe token is unchanged. The Edge Function source matches the tested module and was not deployed in this session.

## Schema

None.

## Platform behavior

Windows and Android both use `PlatformAdapter.createCapture()`. Windows stays on Web Audio. Android stays on native `AudioRecord`, because the WebView cannot open the microphone while the app is hidden. This phase does not add a floating Assistant control, so Android capture is the same path used when the app is in the foreground. Echo cancellation stays the capture default so the speaker is less likely to be heard as the user.

## Automated checks

`pnpm check` passed: lint, `tsc --noEmit`, 41 files, 256 tests.

Covered: 16 kHz MIME, audio forwarding across two turns, input transcription, End stopping capture and dropping a later chunk, Assistant refusing to start while dictation holds the lease, dictation capture refusing to start while Assistant holds it, typed turns, and the existing dictation suite.

Not run: a live microphone against Gemini, on Windows or Android.

## Manual test

Deploy `supabase/functions/gemini-token` first if that deploy from phase 01 is not already live. This phase adds `inputAudioTranscription` to the assistant token lock.

### Windows

1. Start Assistant. Status becomes **Listening**.
2. Say: `My favorite test number is forty two.`
3. Wait for Gemini.
4. Ask: `What test number did I just give you?`
5. Pass if your words appear, Gemini speaks, and the answer is 42.
6. End Assistant. Pass if the microphone and playback stop.

### Android

Repeat the same steps with the app in the foreground.

### Regression

End Assistant, then dictate: `This is a normal dictation regression test.` Pass if insert still behaves as before. While Assistant is listening, dictation and the overlay mic should not start a second capture.

## Known limitations

- Live speech was not verified against Gemini or on a device.
- No Assistant hotkey, overlay Assistant mode, selection context, tools, Search, screenshots, saved memory, or remote context.
- The conversation is still only in memory. End starts a fresh Gemini session the next time.
- Sessions are not resumed. The assistant token still lasts 30 minutes and must open its socket within 2 minutes.
- Automatic VAD can treat speaker bleed as the user. Echo cancellation is the existing capture setting, not a new one.
- A reply that never starts within 45 seconds of a finished user turn still ends the session.
- The token function must be deployed for the new input-transcription lock. Until then, a previously deployed phase 01 function may still accept the client's setup field, but that was not tested here.

## Next-phase boundary

Stop here. Do not add an Assistant hotkey, floating-control Assistant mode, selection context, tools, Search, screenshots, remote context, or memory.
