# Phase 1 implementation report — Gemini transcription proof

## Scope

Only `prompts/01-gemini-proof.md` was implemented: in-app Record → microphone → Gemini Live → Stop → partial/final transcript in the app UI. No hotkey, external insertion, Supabase token endpoint, dictionary sync, Android overlay, AccessibilityService, or packaging.

## Verified Gemini API (official docs, checked 2026-09-27)

Sources:

- https://ai.google.dev/gemini-api/docs/live-api/live-transcribe
- https://ai.google.dev/gemini-api/docs/models (Gemini 3.5 Transcribe, "last updated 2026-09-24")
- https://ai.google.dev/gemini-api/docs/models/gemini-3.5-transcribe

| Item | Value used |
| --- | --- |
| Model | `gemini-3.5-transcribe-live` (sent as `models/gemini-3.5-transcribe-live`) |
| Transport | Raw WebSocket `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent` |
| Setup | `generationConfig.responseModalities: ["TEXT"]`, `inputAudioTranscription: { mode, languageCodes, customVocabulary? }` |
| Smart transcription | `inputAudioTranscription.mode: "SMART"` (default on; `"VERBATIM"` is the API default) |
| Custom vocabulary | `inputAudioTranscription.customVocabulary: string[]` (≤1,000 terms, best ≤100). Wired but empty in Phase 1. |
| Language | `languageCodes: []` → automatic detection |
| Turn control | Manual VAD (push-to-talk): `realtimeInputConfig.automaticActivityDetection.disabled: true`, then `realtimeInput.activityStart` / `realtimeInput.activityEnd` |
| Audio | Raw 16-bit PCM, 16 kHz, mono, little-endian, base64 in `realtimeInput.audio { data, mimeType: "audio/pcm;rate=16000" }`, 100 ms chunks (1,600 frames) |
| Partial events | `serverContent.interimInputTranscription.text` |
| Final events | `serverContent.inputTranscription.text` |
| Session limit | 10 minutes per session (app caps a proof utterance at 5 minutes) |
| Client credential (Phase 4) | Ephemeral tokens via `v1beta/auth_tokens` with `liveConnectConstraints` |

Durable deviation from old project wording: none needed. The docs' field names match `docs/SPEC.md`'s intent. The Vertex/Enterprise variant is named `gemini-3.5-transcribe-live-preview`; this app uses the Gemini Developer API name above.

## Changes

- `src/voice/provider/gemini/GeminiProvider.ts`: Gemini session behind `TranscriptionSession`. Finals emitted on in-utterance pauses are accumulated and joined; the first final after `activityEnd` completes the utterance, and later duplicates are dropped. Unexpected closes surface the close code/reason with API-key-shaped strings redacted. Refuses to construct in production builds.
- `src/voice/session/DictationController.ts`: provider/platform-agnostic orchestration driven by `voiceReducer`. Audio captured while connecting is buffered and sent after `activityStart`. A Stop pressed during CONNECTING is honored once connected. Duplicate/early finals are ignored. Every failure routes to `ERROR` and releases capture and session.
- `src/app/useDictation.ts`, `src/app/App.tsx`, `src/app/app.css`: Record/Stop control, live partial, final transcript, error alert with "Try again", and globally hidden scrollbars. The development API key field is rendered only in dev builds and held in React memory only.
- `src/platform/BrowserAudioCapture.ts`: preserve the original error as `cause` (lint).
- `tsconfig.json`: `lib` ES2020 → ES2022 for `Error` `cause`.
- `src-tauri/tauri.conf.json`: `devCsp` allows `wss://generativelanguage.googleapis.com`. The production `csp` is unchanged until Phase 4 ships the token path.
- Tests: `GeminiProvider.test.ts` (6), `DictationController.test.ts` (7).

Lifecycle note: in Phase 1 "inserting" means showing the transcript in the app. The controller passes through `INSERTING` so Phase 2 only swaps in the platform adapter.

## Credential handling

- Dev-only: paste a Gemini API key into the app while running `pnpm tauri dev`. It is not persisted, not read from env files, and not bundled.
- The key only appears in the WebSocket URL (as in Google's raw-WebSocket example). It is never logged or displayed.
- `pnpm build` output was scanned: no dev key UI and no `AIza…` strings.

## Checks

| Command | Result |
| --- | --- |
| `pnpm lint` | PASS |
| `pnpm typecheck` | PASS |
| `pnpm test` | PASS, 3 files / 19 tests |
| `pnpm build` | PASS; worklet emitted as its own asset |
| `cargo check --locked` | PASS (only the known exFAT incremental-cache warning) |

## Acceptance criteria

| Criterion | Status |
| --- | --- |
| User can press Record | PASS, `pnpm tauri dev` |
| Microphone audio reaches Gemini | PASS, live run by the user with a development key (2026-09-27) |
| Partial transcript appears if supported | PASS, live transcript shown while speaking |
| Stop/finalize yields one final transcript | PASS live; also unit-tested (provider + controller) |
| Transcript appears in the app UI | PASS, live |
| Duplicate final events do not duplicate output | Unit-tested at both layers |
| Provider errors produce a controlled error state | Unit-tested |
| Secrets are not committed | No keys in source or build; `.env*` ignored. No Git repository exists yet. |

## Unresolved

- Not yet observed live: whether a final arrives after `activityEnd` for a silent utterance. A silent Stop may end in a 20-second "No final transcript" error, which Phase 3 should refine.
- Imports stay relative to match the Phase 0 convention; there is no `@/` alias configured.
