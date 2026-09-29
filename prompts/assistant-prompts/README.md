# Personal Voice — Assistant Build Prompt Set

Run these prompts in numerical order. At the end of every phase, let the coding agent finish its automated tests, read the report it creates under `docs/Assistant-Phases/`, perform the manual test yourself, and do not move forward until the phase passes.

## Architecture

```text
Personal Voice
├── Dictation
│   └── Gemini 3.5 Transcribe Live
│       └── DictationController
└── Assistant
    └── Gemini 3.8 Live
        └── AssistantController
```

Dictation remains its own production path. Do not force Assistant semantics into `DictationController` or the transcription-specific `VoiceProvider`.

## Build order

| # | Phase |
|---|---|
| 01 | Gemini 3.8 Live foundation |
| 02 | Live microphone conversation |
| 03 | Interruption + session resilience |
| 04 | Assistant quick access |
| 05 | Selection context + voice instruction |
| 06 | Safe Assistant actions |
| 07 | Google Search grounding |
| 08 | Explicit screen/window snapshot |
| 09 | Screen-aware multi-turn conversation |
| 10 | Voice Notes + Handoffs as context |
| 11 | Cross-device Assistant handoff |
| 12 | Remote device context |
| 13 | Personal context + analytics profile |
| 14 | Supervised computer actions |
| 15 | Final integration audit |

## Current Google Live assumptions

These prompts target the September 2026 Gemini API state:

- Assistant: `gemini-3.8-live`
- Dictation stays `gemini-3.5-transcribe-live`
- client-side Live uses ephemeral tokens
- ephemeral-token Live connections use the current `v1beta` constrained WebSocket endpoint
- Gemini 3.8 Live responds with native `AUDIO`
- input audio is raw PCM16 little-endian, normally 16 kHz mono
- model audio output is PCM16 at 24 kHz
- use output audio transcription when readable Assistant text is needed
- Gemini 3.8 Live supports function calling and Search grounding
- session resumption and context-window compression support longer sessions

Every phase that touches Google protocol details must verify the current official Google documentation before coding.
