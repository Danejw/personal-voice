# PV2 implementation report — dictation destinations

Prompt: `prompts/PV-Prompts/Done/01-PV2-dictation-destinations.md`

## Scope

Separate transcription from where a finalized transcript goes. `DictationController` delivers to a `TranscriptDestination` instead of calling `platform.insertText()` itself. Active field remained the only destination in this phase; later PVs added more routes without changing Gemini or recovery.

## What shipped

```text
VoiceProvider
↓ final transcript
DictationController
↓
TranscriptDestinationRouter
└─ active-field → PlatformAdapter.insertText()
```

- `src/voice/transcript/TranscriptDestination.ts`: `deliver(transcript)`, destination ids, and `TranscriptDestinationRouter` that resolves the selected destination at delivery time.
- Destination failure still follows `ERROR` and leaves the transcript visible.
- Settings: **Send transcript to** picker (Active field only at first; PV1/PV3 added the other options on the same control).

## Deviations

None that change the prompt. The router already accepted a map of destinations so PV1 and PV3 could register without touching the controller.

## Checks

Unit tests in `src/voice/transcript/TranscriptDestination.test.ts` cover delivery to the selected destination and failure surfacing. Shared `pnpm` lint/typecheck/test passed in the PV lineage; Gemini and push-to-talk were not redesigned.

## How to confirm quickly

Dictate with destination **Active field** into Notepad (or a focused Android field). Behavior should match pre-PV dictation: text inserts, recovery still works, a paste/insert failure shows as dictation error with the transcript still on screen.
