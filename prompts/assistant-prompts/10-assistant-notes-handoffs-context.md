# ASSISTANT BUILD ORDER 10 — Voice Notes + Handoffs as Explicit Context

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

Let the user deliberately attach existing Personal Voice data:
- one or more selected Voice Notes
- one selected/pending Handoff

Do not dump the whole account into Gemini.

## CONTEXT SELECTION

Reuse existing authenticated stores/services.

Clearly display attached items. Bound item count and total content size.

Assistant may summarize, compare, discuss, or turn attached information into a plan.

Do not mutate/archive/delete a source item merely because it was attached.

## OWNERSHIP

Attached items are current-session context only unless the user explicitly saves derived output through an existing tool.

Do not duplicate notes/handoffs into another context database.

## TESTS

Cover explicit selection, limits, detach, source immutability, multi-item reasoning, sign-out, and offline behavior.

## REQUIRED IMPLEMENTATION REPORT

When complete, create `docs/Assistant-Phases/10-assistant-notes-handoffs-context.md` and update `docs/Assistant-Phases/README.md`.

Record the goal, starting state, exact implementation, files changed, model/API/config, schema changes, platform behavior, automated tests/results, manual test procedure, limitations, and next-phase boundary. The report is the permanent truth; do not claim unbuilt behavior.


# MANUAL TEST — PHASE 10

1. Create two short Voice Notes with different facts.
2. Attach both to Assistant.
3. Ask: `Summarize the two attached notes and tell me how they differ.`
4. PASS if both are used correctly.
5. Detach one note and ask a new question only the removed note could answer.
6. PASS if it is no longer active context.
7. Attach a Handoff and ask for a summary.
8. Verify none of the source rows changed.

STOP after this phase.
