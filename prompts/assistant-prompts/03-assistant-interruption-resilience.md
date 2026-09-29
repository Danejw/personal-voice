# ASSISTANT BUILD ORDER 03 — Interruption + Session Resilience

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

Make the Live Assistant behave like a real conversation instead of a fragile demo.

Implement:
- barge-in/interruption
- immediate queued-audio cancellation
- Live session resumption
- GoAway handling
- context-window compression
- recoverable WebSocket reconnect without losing conversation when supported

## GOOGLE SESSION BEHAVIOR

Verify current official docs first. Current concepts include:
- `sessionResumption`
- resumption updates/handles
- server connection lifetime around 10 minutes
- GoAway
- `contextWindowCompression`
- client-content interruption semantics

Use current behavior.

## INTERRUPTION

When the user starts speaking while Gemini speaks:
- stop/flush queued playback promptly
- follow current Live interruption semantics
- continue the new user turn
- reject stale model audio/transcription after the interruption boundary

## RESUMPTION

Keep only the minimal state:
- newest valid resumption handle
- connection generation
- lifecycle state

Keep handles in memory only unless current API requirements force otherwise.

On recoverable disconnect:
- obtain a valid Assistant token if needed
- reconnect with the latest valid handle
- return to listening/ready
- do not affect Dictation

If the session cannot be resumed, fail clearly rather than pretending context survived.

## MANUAL-TEST HOOK

Add a safe dev-only way to force an Assistant reconnect without exposing credentials.

## TESTS

Cover interruption, stale audio, resumption-handle parsing, reconnect using newest handle, old socket rejection, GoAway, non-resumable failure, context compression setup, and Dictation regression.

## REQUIRED IMPLEMENTATION REPORT

When this phase is complete, create:

`docs/Assistant-Phases/03-assistant-interruption-resilience.md`

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


# MANUAL TEST — PHASE 03

1. Ask Assistant for a long explanation.
2. While Gemini is speaking, interrupt: `Stop. Give me the answer in one sentence.`
3. PASS if old audio stops promptly and Gemini responds to the interruption.
4. Tell it a memorable fact.
5. Trigger the dev-only forced reconnect.
6. Ask it to recall the fact.
7. PASS if context survives the reconnect.
8. End Assistant and verify normal Dictation.

STOP after this phase.
