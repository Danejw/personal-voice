# ASSISTANT BUILD ORDER 01 — Gemini 3.8 Live Foundation

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

Create the smallest real Assistant pipeline while leaving working dictation untouched.

Prove:

```text
Assistant page
→ Start
→ authenticated short-lived Gemini token
→ Gemini 3.8 Live
→ typed user turn
→ native spoken response
→ readable output transcription
→ second turn on same session
→ End
```

No Assistant microphone input yet.

## ARCHITECTURE

Keep separate:

```text
Dictation → Gemini 3.5 Transcribe Live → DictationController
Assistant → Gemini 3.8 Live → AssistantController
```

Create a small `src/assistant/` area with a provider/session boundary and explicit lifecycle such as:

```text
IDLE → CONNECTING → READY → RESPONDING → READY
                          ↘ ERROR
```

Do not generalize `DictationController`.

## GOOGLE API

Verify current official Google docs first. Expected current configuration:

- model `gemini-3.8-live`
- ephemeral-token provisioning through current `v1beta`
- constrained `v1beta` Live WebSocket
- response modality `AUDIO`
- enable `outputAudioTranscription`
- output PCM16 24 kHz

Extend the current secure token service with an explicit Assistant purpose such as:

```json
{ "purpose": "assistant" }
```

Default/existing requests must still produce the existing Gemini 3.5 Transcribe token. Assistant requests are constrained to Gemini 3.8 Live. Keep the permanent Google API key server-side and never log tokens.

## ASSISTANT TRANSPORT

Normalize Gemini wire messages into application events instead of leaking raw JSON through React.

Support:
- connect
- completed typed user turn
- streaming Assistant audio
- output transcription
- turn completion
- close
- useful typed errors
- stale-event rejection after session end/replacement

Use Live client content/realtime text according to current docs. Do not use `generateContent`.

## AUDIO PLAYBACK

Implement a small reusable streaming PCM playback path:
- preserve chunk order
- play the documented sample rate correctly
- clear immediately on End
- write no audio to disk
- playback errors must not crash the app
- prefer Web Audio over a large new dependency if practical

## UI

Add `Assistant` as a top-level navigation destination. Keep it compact:

```text
Assistant                         [Start / End]
Status

conversation

[ Type a message...                         ] [Send]
```

Conversation is in memory only.

## DO NOT BUILD YET

No Assistant microphone, interruption, quick-access shortcut, selection context, tools, Search, screenshots, memory, cross-device Assistant, or computer control.

## TESTS

Cover token purpose, default Dictation token behavior, Assistant setup/message parsing, output transcription, PCM parsing, lifecycle, second turn same-session behavior, End/stale events, and existing Dictation tests.

Run `pnpm typecheck`, `pnpm test`, and the relevant repo build/check command.

## REQUIRED IMPLEMENTATION REPORT

When this phase is complete, create:

`docs/Assistant-Phases/01-assistant-live-foundation.md`

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


# MANUAL TEST — PHASE 01

1. Sign in and open **Assistant**.
2. Click **Start Assistant** and confirm Ready.
3. Type: `Reply with exactly: Assistant online.`
4. PASS if audio plays, readable Assistant text appears, and state returns to Ready.
5. Without ending, type: `What exact phrase did I ask you to say in my previous message?`
6. PASS if Gemini remembers the previous turn.
7. Click **End Assistant** and confirm audio stops and delayed output does not appear.
8. Use normal Dictation and say: `This is a normal dictation regression test.`
9. PASS if Gemini 3.5 Transcribe still inserts text exactly as before.

STOP after this phase.
