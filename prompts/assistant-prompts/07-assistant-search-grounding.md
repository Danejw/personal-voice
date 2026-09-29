# ASSISTANT BUILD ORDER 07 — Google Search Grounding

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

Allow the live Assistant to answer current-information questions using Gemini 3.8 Live's supported Google Search grounding.

Use this for changing public information. Do not build a second web-search backend if the current native Live Search grounding supports the task.

## GOOGLE CONFIG

Verify the current official Gemini 3.8 Live Search-grounding schema.

Enable it only for Assistant Mode.

Normalize useful grounding metadata/citations into application-level data instead of leaking raw provider payloads into UI code.

Do not force Search on every turn. Ordinary conversational/math questions should remain ordinary.

## UX

Keep the response spoken. When grounding occurs, show compact useful source information in the Assistant page.

Do not falsely label an ungrounded answer as sourced.

## PRIVACY

Do not unnecessarily send private selection/screenshot/note content through a Search-grounded turn. Only use explicit current session context when needed for the user's request.

## TESTS

Cover Search configuration, grounding metadata parsing, source rendering, ordinary ungrounded turns, and errors.

## REQUIRED IMPLEMENTATION REPORT

When complete, create `docs/Assistant-Phases/07-assistant-search-grounding.md` and update `docs/Assistant-Phases/README.md`.

Record the goal, starting state, exact implementation, files changed, model/API/config, schema changes, platform behavior, automated tests/results, manual test procedure, limitations, and next-phase boundary. The report is the permanent truth; do not claim unbuilt behavior.


# MANUAL TEST — PHASE 07

1. Ask: `What is 12 times 8?`
2. PASS if it answers normally without pretending Search was used.
3. Ask: `What is the latest stable Gemini Live model available right now? Search if needed.`
4. PASS if current grounding is used and useful source information is shown while the answer is spoken.
5. Ask a follow-up about one sourced fact.
6. PASS if context remains coherent.

STOP after this phase.
