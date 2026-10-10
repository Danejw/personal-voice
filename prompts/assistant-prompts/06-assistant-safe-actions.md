# ASSISTANT BUILD ORDER 06 — Safe Assistant Actions

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

Give Gemini 3.8 Live a small explicit tool set backed by capabilities Personal Voice already owns.

Initial tools:

```text
insert_text
copy_text
create_note
send_handoff
```

If the current platform architecture can safely replace an explicitly captured selection, add a narrow `replace_selection` action; otherwise leave it out and document why.

## TOOL BOUNDARY

Use the current Gemini Live function-calling protocol.

```text
Gemini requests typed tool
→ Assistant tool router validates
→ confirmation policy
→ existing Personal Voice service/platform function executes
→ typed real result returned to Gemini
```

Do not duplicate Note/Handoff business logic inside Gemini code. Schemas must be explicit and tested. Preserve function call IDs/correlation.

Verify Gemini 3.8 Live's current asynchronous function-calling and scheduling behavior before coding.

## CONFIRMATION

Require confirmation for anything that:
- sends data to another device/service
- modifies text in another application
- replaces selected text
- submits or materially changes external state

A low-risk reversible copy-to-clipboard action may execute directly if the UX is clear.

Never tell Gemini an action succeeded unless the underlying app returned success.

## UI

Show pending action clearly, for example:

```text
Assistant wants to:
Send this text to Desktop

[Confirm] [Cancel]
```

Support confirmation from compact/floating flow where practical.

## TESTS

Cover schema validation, confirmation, cancellation, service reuse, failure propagation, tool-response IDs, and no bypass from malformed Gemini arguments.

## REQUIRED IMPLEMENTATION REPORT

When complete, create `docs/Assistant-Phases/06-assistant-safe-actions.md` and update `docs/Assistant-Phases/README.md`.

Record the goal, starting state, exact implementation, files changed, model/API/config, schema changes, platform behavior, automated tests/results, manual test procedure, limitations, and next-phase boundary. The report is the permanent truth; do not claim unbuilt behavior.


# MANUAL TEST — PHASE 06

1. Ask: `Create a note that says Assistant tool test.`
2. Confirm if prompted.
3. PASS if it appears in the existing Notes inbox.
4. Ask: `Copy the words copied by assistant to my clipboard.`
5. PASS if pasting elsewhere yields the expected text.
6. Ask to insert/replace harmless text in another app.
7. PASS only if the modification follows the confirmation policy and actually occurs.
8. Cancel one proposed modifying action.
9. PASS if nothing changes.

STOP after this phase.
