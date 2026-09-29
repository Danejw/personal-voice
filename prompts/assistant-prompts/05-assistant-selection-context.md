# ASSISTANT BUILD ORDER 05 — Selection Context + Voice Instruction

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

Combine existing explicit Selection Capture with Assistant Mode.

```text
highlight text
→ capture selection
→ ask Assistant by voice/text
→ Assistant reasons over that exact selection
```

Examples:
- Explain this error.
- Rewrite this more clearly.
- What does this function do?
- Summarize this paragraph.

## CONTEXT MODEL

Reuse existing `ContextItem`.

Do not scrape surrounding application content.

Show attached selection clearly:
- short preview
- source app if known
- remove/detach action

Do not permanently add selected text to memory or analytics.

## DELIVERY

Attach source material using current Live client-content semantics while keeping the user's instruction distinct.

Bound context size and handle overly large selections clearly.

Make the Capture Selection → Ask Assistant flow usable from quick access where practical.

## NO MODIFICATION YET

Assistant may suggest rewritten text, but do not replace source text in this phase.

## TESTS

Cover attach/remove, source metadata, bounds, no automatic capture, and context cleanup.

## REQUIRED IMPLEMENTATION REPORT

When this phase is complete, create:

`docs/Assistant-Phases/05-assistant-selection-context.md`

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


# MANUAL TEST — PHASE 05

1. Select: `Persyn are a application that help create content.`
2. Capture it.
3. Ask Assistant: `Rewrite the selected sentence so the grammar is correct.`
4. PASS if Gemini uses the exact selection and proposes a correction.
5. Remove the selection.
6. Start a fresh context/turn according to the implemented lifetime rule and ask about the removed sentence.
7. PASS if it is no longer active context.
8. Verify the original app text was not changed.

STOP after this phase.
