# ASSISTANT BUILD ORDER 02 — Live Microphone Conversation

## BRANCH + GROUND TRUTH

Before changing code:

1. Run `git branch --show-current`.
2. The implementation branch must be `assistant`.
3. If the current branch is not `assistant`, STOP. Do not modify `main` and do not switch branches without the user doing so.
4. Read `AGENTS.md`, `docs/SPEC.md`, `docs/ARCHITECTURE.md`, `docs/BACKEND_SYNC.md`, and `docs/PV-Phases/README.md`.
5. Read every prior report in `docs/Assistant-Phases/`.
6. Inspect the current code paths you will touch. The local `assistant` branch is truth; do not implement from assumptions if the branch has moved forward.

Preserve working Windows and Android dictation.


## GOAL

Turn the typed Gemini 3.8 Live Assistant into a real spoken conversation while reusing the proven Personal Voice microphone infrastructure.

```text
Start Assistant
→ speak
→ user transcript
→ Gemini speaks back
→ Assistant transcript
→ keep talking in same session
```

## AUDIO INPUT

Reuse the existing `PlatformAdapter`/`AudioCapture` path where practical. Personal Voice already produces PCM16 mono 16 kHz on Windows and Android.

Verify current Live docs. Expected:
- PCM16 little-endian
- 16 kHz mono input
- small chunks, roughly 20–100 ms
- 24 kHz PCM16 model output

Never persist microphone audio.

## TURN TAKING

Use Gemini Live's current automatic VAD initially unless the current docs or testing justify a different approach.

Enable `inputAudioTranscription`.

AssistantController owns conversational capture. `DictationController` stays unchanged.

Required:
- Start opens one Live session and begins listening
- stream microphone while active
- show User transcription
- play model audio
- show Assistant transcription
- multiple turns stay in same session
- End stops capture and playback

Prevent Assistant and Dictation from owning the microphone at the same time with one small, explicit ownership rule.

Keep the typed input from Phase 01.

## DO NOT BUILD YET

No custom Assistant hotkey, floating-control Assistant mode, selection context, tools, Search, screenshots, remote context, or memory.

## TESTS

Cover audio forwarding, MIME/sample rate, input transcription, multiple turns, End stopping capture, Assistant/Dictation microphone exclusion, and Dictation regression.

## REQUIRED IMPLEMENTATION REPORT

When this phase is complete, create:

`docs/Assistant-Phases/02-assistant-live-voice.md`

If `docs/Assistant-Phases/README.md` does not exist, create it and maintain a completed-phase index.

Record:
- phase goal
- starting state that mattered
- exact implementation completed
- important files changed
- model/API/endpoints/config used
- schema changes, if any
- platform-specific behavior
- automated tests and results
- manual test procedure
- known limitations
- explicit next-phase boundary

This report is the permanent truth of what was actually implemented. Do not claim unbuilt or untested behavior.


# MANUAL TEST — PHASE 02

### Windows
1. Start Assistant.
2. Say: `My favorite test number is forty two.`
3. Wait for Gemini.
4. Ask: `What test number did I just give you?`
5. PASS if your transcript appears, Gemini speaks, and it answers 42.

### Android
Repeat the same test.

### Regression
End Assistant and perform normal Dictation on both platforms.

PASS only if Assistant voice works on both and Dictation remains unchanged.

STOP after this phase.
