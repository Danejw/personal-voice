# ASSISTANT BUILD ORDER 09 — Screen-Aware Multi-Turn Conversation

## BRANCH + GROUND TRUTH

Before changing code:

1. Run `git branch --show-current`.
2. The implementation branch must be `assistant`.
3. If the current branch is not `assistant`, STOP. Do not modify `main` and do not switch branches without the user doing so.
4. Read `AGENTS.md`, `docs/SPEC.md`, `docs/ARCHITECTURE.md`, `docs/BACKEND_SYNC.md`, and `docs/PV-Phases/README.md`.
5. Read every prior report in `docs/Assistant-Phases/`.
6. Inspect the current code paths you will touch. The local `assistant` branch is truth.

Preserve working Windows and Android dictation.


## GOAL

Keep intentionally supplied visual context usable across several turns without silently capturing a new screen.

Example:

```text
attach screenshot
→ "Why is this error happening?"
→ "Which line should I change?"
→ "What does the warning below it mean?"
```

## CONTEXT LIFETIME

Implement explicit state:
- active screenshot
- replace
- recapture
- remove

The current image remains active according to a clear documented session rule.

Never silently refresh it because the real screen changed. If the user says `look again`, require/use an explicit recapture action.

## CONTEXT EFFICIENCY

Do not repeatedly append duplicate copies of the same image if the current Live session already contains it.

Use current Live context/client-content behavior to keep context bounded.

Selection and screenshot context may coexist, and the UI must show which items are attached.

## TESTS

Cover persistence, replace/remove, no implicit recapture, combined selection+image, session cleanup, and context-size behavior.

## REQUIRED IMPLEMENTATION REPORT

When complete, create `docs/Assistant-Phases/09-assistant-screen-aware-conversation.md` and update `docs/Assistant-Phases/README.md`.

Record the goal, starting state, exact implementation, files changed, model/API/config, schema changes, platform behavior, automated tests/results, manual test procedure, limitations, and next-phase boundary. The report is the permanent truth; do not claim unbuilt behavior.


# MANUAL TEST — PHASE 09

1. Capture a screenshot with at least two distinct details.
2. Ask about detail #1.
3. Without recapturing, ask about detail #2.
4. PASS if Gemini still uses the attached image.
5. Change the actual screen but do NOT recapture.
6. Ask what it sees.
7. PASS if it still refers to the old attached image rather than pretending it saw the new screen.
8. Recapture and ask again.
9. PASS if it now uses the new image.

STOP after this phase.
