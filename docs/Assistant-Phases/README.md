# Assistant phases

These reports cover the Assistant pipeline. It is separate from dictation. Dictation stays Gemini 3.5 Transcribe Live. Assistant uses Gemini 3.8 Live. Personal Voice reports stay in `docs/PV-Phases/`. V1 reports stay in `docs/PHASE_*_REPORT.md`.

## Completed

| Prompt | Report |
| --- | --- |
| 01 Gemini 3.8 Live foundation | [01-assistant-live-foundation.md](./01-assistant-live-foundation.md) |
| 02 Live microphone conversation | [02-assistant-live-voice.md](./02-assistant-live-voice.md) |
| 03 Interruption and session resumption | [03-assistant-interruption-resilience.md](./03-assistant-interruption-resilience.md) |
| 04 Quick access | [04-assistant-quick-access.md](./04-assistant-quick-access.md) |
| 05 Selection context | [05-assistant-selection-context.md](./05-assistant-selection-context.md) |
| 06 Safe actions | [06-assistant-safe-actions.md](./06-assistant-safe-actions.md) |
| 07 Google Search grounding | [07-assistant-search-grounding.md](./07-assistant-search-grounding.md) |
| 09 Screen-aware conversation | [09-assistant-screen-aware-conversation.md](./09-assistant-screen-aware-conversation.md) |
| 10 Notes and handoff context | [10-assistant-notes-handoffs-context.md](./10-assistant-notes-handoffs-context.md) |
| 11 Cross-device Assistant handoff | [11-assistant-cross-device-handoff.md](./11-assistant-cross-device-handoff.md) |
| 12 Remote device context | [12-assistant-remote-device-context.md](./12-assistant-remote-device-context.md) |
| 13 Personal context | [13-assistant-personal-context.md](./13-assistant-personal-context.md) |
| 14 Supervised computer actions | [14-assistant-computer-actions.md](./14-assistant-computer-actions.md) |
| 15 Final audit | [15-assistant-final-audit.md](./15-assistant-final-audit.md) |

## Not started

Nothing further in this build order. An explicit screenshot can be attached and reused across later questions. Up to eight notes and one received handoff can be attached as this session's context. A continuation package can be sent to another owned device and opened as a new Assistant session. A read-only request can ask another owned Windows device what is on screen. The Assistant page keeps analytics facts that clear a threshold in a collapsed Personal context disclosure beside the conversation. Use analytics profile is in Settings. Allowlisted desktop actions can open Notepad or Calculator, press a few shortcuts, or insert text, each after confirmation. A supervised screen task is a separate Computer Use loop. There is no shell. There is no separate phase 08 report; that capture is the base of phase 09.
