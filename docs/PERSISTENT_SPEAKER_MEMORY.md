# Persistent Speaker Memory: implementation plan

Status: **foundation in progress on `feat/persistent-speaker-memory`**. No user-visible speaker recognition, native model loading, capture integration, or biometric persistence has shipped.

## Goal

Personal Voice recognizes its explicitly enrolled **primary user** across normal Dictation and Assistant sessions. Over time it can distinguish known, consenting speakers from unknown speech without confusing TV/video narration, ambient conversation, or synthetic playback with the user. Profiles remain reusable across supported Windows and Android devices, subject to local-only enrollment and storage. This is identity context, **not** authentication for sensitive actions.

## Verified repository starting point (main, 2026-11-19)

- One Tauri 2 app with React/TypeScript, Rust Windows integration, and a native Kotlin Android plugin. Read `AGENTS.md` and `docs/SPEC.md` before implementation.
- `src/voice/audio/AudioCapture.ts`: both Dictation and Assistant accept callback-delivered PCM chunks.
- `src/platform/BrowserAudioCapture.ts`: Windows WebView capture, 16 kHz mono PCM. `getUserMedia` currently requests echo cancellation and noise suppression.
- `src-tauri/gen/android/app/src/main/java/com/personal/voiceapp/platform/NativeMicCapture.kt`: Android `AudioRecord`, 16 kHz PCM16, 100 ms chunks; Dictation and Assistant use different audio sources and echo policies.
- `src/voice/audio/microphoneLease.ts`: Dictation and Assistant share one exclusive microphone lease.
- `src/voice/session/DictationController.ts` and `src/assistant/AssistantController.ts`: existing transcription and Live Assistant flows.
- Existing app policy prohibits permanent/synced microphone audio; do not change this. Current Assistant memory is text context, **not** a speaker embedding store.

## Chosen boundaries

```text
Existing platform microphone capture
    | 16 kHz PCM, capture/session timestamps (no second mic)
    +----> Existing Gemini Transcription / Live Assistant (unchanged)
    |
    +----> Local VAD / sample quality / segmentation
            |
            +--> ONNX speaker embedding extractor (native, CPU; configurable)
                  |
                  +--> SpeakerRegistry (model-scoped, conservative matching)
                  |     +--> primary | known | unknown
                  |
                  +--> encrypted per-account/per-device local speaker store
                            +--> explicit enroll, rename, forget, reset
```

**Do not confuse speaker identification with diarization.** The first milestone performs single-speaker identification on clear utterances only. Speaker diarization for multiple or overlapping people is a separate subsequent milestone; embeddings alone cannot isolate simultaneous voices.

**No new network provider**, no Supabase speaker embeddings, no raw-audio uploads for speaker recognition, no permanent microphone recordings, no always-on/background recording, and no modification to Gemini's provider contract.

## Milestone 0: verified shared speaker domain (committed foundation)

- `src/speakers/SpeakerRegistry.ts`: normalized, finite, model-versioned embeddings; account-scoped profiles with one explicitly chosen primary; multiple verified exemplars; similarity and separation thresholds supplied by model evaluation; unknown and ambiguous outcomes; no self-training on guessed labels.
- `src/speakers/SpeakerRegistry.test.ts`: unit tests for the above and validation on restore.
- No persistence adapter or UI is connected yet. Tests are not equivalent to on-device recognition.
- Never persist these snapshots in `localStorage` or plaintext JSON. They are biometric identifiers.

## Milestone 1: local primary identification (first usable vertical slice)

1. Select one version-pinned, license-reviewed sherpa-onnx speaker-embedding model supporting 16 kHz audio. Record download URL, model SHA-256, model key, embedding dimensions, native library version, bundle size, and Windows/Android CPU performance. Benchmark on actual target devices. Do not silently change model identity later.
2. Implement a **native** `SpeakerEmbeddingExtractor` for Android Kotlin and Windows Rust/Tauri (or one verified shared native binding). Explicitly check the current sherpa-onnx APIs and packaging for both ABIs; avoid implying that a Python/Node binding runs in the Android app. Load only after opt-in. No placeholder or mock identity may reach production.
3. Add a bounded passive observer at the existing `AudioCapture` boundary. Send a *copy* of short clear speech windows to the native worker off the capture thread; never hold up Gemini streaming. Drop corrupt, too-short, clipped, overlapping, playback-contaminated or low-speech segments. Retain only volatile PCM until scored.
4. In Settings, add **Voice recognition: Off by default**, explicit primary-user enrollment using several clean utterances from real use or a guided enrollment, enrollment review, delete/reset, and status. Authenticated account/device ownership is determined by existing signed-in account state, never by frequency alone.
5. Wire model outputs to the registry. Show `Primary user`, `Unknown`, or `Uncertain` status with conservative calibrated thresholds. Do not silently discard existing dictation or gate Assistant actions based on an untrusted voice match.
6. Add encrypted local speaker-profile persistence using OS-protected secrets (Windows DPAPI/Credential Manager, Android Keystore or an audited Tauri secure-storage equivalent). Scope by account/device and model key. Clear all in-memory identity state on sign-out/account switch; delete keys and encrypted vectors on explicit Forget. Never log embeddings.
7. Manual validation: clean speech, whisper/loud speech, varied distance, headset vs built-in mic, background video, two people taking turns, simultaneous speakers, replay attack, offline use, restart/profile restore, account switch, permission denied, Android background/foreground transitions, and model-unavailable fallback.

Milestone 1 acceptance: clean user enrollment and persisted recognition genuinely run *on the device*; Gemini Dictation/Assistant continue working at baseline latency and reliability; unknown/ambiguous voices remain unknown; no unexpected audio retention; uninstall/forget and account isolation verified.

## Milestone 2: consenting known speakers

- Add pending anonymous speaker IDs **in memory only** during a session, separate from stored profiles.
- Ask for a name only at an appropriate time, then obtain that individual's consent before persistent enrollment. Naming by the primary user alone is not proof of the individual's consent.
- Store several explicitly verified samples, not a single running average. Never automatically add a voice to an existing identity from a model guess.
- Support rename, merge after review, forget, and opt-out. Expose only required identity context to the assistant.
- Evaluate false accepts/false rejects and calibration per microphone/model; never present a cosine score as a calibrated probability.

## Milestone 3: multi-speaker context

- Add reliable voice activity detection, segmentation, speaker diarization across time, optional local playback-source separation where the OS permits it, and overlap detection.
- Keep speech-to-person association across sessions through the same identity registry.
- Speaker diarization is *not* proof of isolated audio during simultaneous speech. For overlapping speech, use a tested source separation model or mark the segment uncertain.
- Expose concise timestamped speaker events to Assistant context only after the user enables them. Video/TV audio must not be interpreted as a command.

## Tests / release gates

- `pnpm check`; `pnpm eval:tools` only when Assistant tool declarations/semantics change, following `src/assistant/harness/AGENTS.md`.
- Windows and Android GitHub Validate jobs, plus physical-device smoke tests. A passing TypeScript test does not validate native inference.
- Measure embedding computation latency, CPU/battery cost, consent/forget behavior, false-positive owner matches, and audio-to-Gemini latency regression on target hardware.
- No automatic release or merge. PR description must list verified changes, CI status, 3–5 step manual check, unresolved limitations, and merge readiness.

## Deferred

Cloud biometric sync, continuous ambient recording, voice-authenticated irreversible actions, unattended recording of friends or bystanders, full separation of simultaneous voices, model retraining, alternate transcription providers, and redesigning the existing dictation/Assistant UX.
