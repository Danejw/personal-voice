# Personal Voice phases

These reports cover work done after V1 (Phases 0–9). Each prompt in `prompts/PV-Prompts/` is one phase. The product is still one Tauri 2 Windows/Android app; Gemini 3.5 Transcribe Live stays the only transcription path.

V1 reports remain in `docs/PHASE_*_REPORT.md`. Architecture and schema notes are also in `docs/ARCHITECTURE.md`, `docs/SPEC.md`, and `docs/BACKEND_SYNC.md`.

## Completed

Implemented in this order (prompt number, then product id):

| Prompt | Product | Report |
| --- | --- | --- |
| 01 | PV2 Dictation destinations | [01-PV2-dictation-destinations.md](./01-PV2-dictation-destinations.md) |
| 02 | PV1 Voice notes inbox | [02-PV1-voice-notes-inbox.md](./02-PV1-voice-notes-inbox.md) |
| 03 | PV3 Cross-device handoff | [03-PV3-cross-device-handoff.md](./03-PV3-cross-device-handoff.md) |
| 04 | PV4 Shared clipboard | [04-PV4-shared-clipboard-send-to-device.md](./04-PV4-shared-clipboard-send-to-device.md) |
| 05 | PV5 Recent dictation history | [05-PV5-recent-dictation-history.md](./05-PV5-recent-dictation-history.md) |
| 06 | PV12 Device management | [06-PV12-better-device-management.md](./06-PV12-better-device-management.md) |
| 07 | PV11 Device-specific preferences | [07-PV11-device-specific-preferences.md](./07-PV11-device-specific-preferences.md) |
| 09 | PV6 Selection capture | [09-PV6-selection-capture.md](./09-PV6-selection-capture.md) |
| 12 | PV17 Lightweight usage intelligence | [12-PV17-lightweight-usage-intelligence.md](./12-PV17-lightweight-usage-intelligence.md) |

## Intentionally skipped

The user jumped ahead in the prompt list. These were not implemented and have no report:

| Prompt | Product | Why |
| --- | --- | --- |
| 08 | PV13 Contextual dictionaries | Skipped; user asked for PV6 next |
| 10 | PV14 App-aware dictionary profiles | Skipped; user asked for PV17 next |
| 11 | PV7 Selection plus voice instruction | Skipped; user asked for PV17 next |

Do not treat skipped ids as done. PV7 in particular depends on PV6 (selection) plus a later instruction path.

## Not started

Everything from `prompts/PV-Prompts/13-PV19-latency-metrics.md` onward, including latency metrics, reliability dashboard, dictionary learning, voice commands, hands-free/continuous dictation, assistant mode, and the rest of the pack.
