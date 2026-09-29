# ASSISTANT BUILD ORDER 11 — Cross-Device Assistant Handoff

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

Let the user deliberately continue an Assistant task from one owned Personal Voice device on another.

Do not transfer a raw Gemini WebSocket session.

## CONTINUATION PACKAGE

Serialize a bounded application-level payload containing only what is needed, for example:
- task/title
- recent user/assistant turns
- explicitly attached text context
- safe references/metadata for attached Personal Voice items
- source device id/name
- timestamp
- payload version

Never include ephemeral tokens, raw audio, Gemini resumption handles, or hidden account data.

Use existing device identity and Handoff architecture where practical, but do not break ordinary text Handoffs. Add a discriminator/version if sharing infrastructure.

## RECEIVER

The receiving device:
- shows that an Assistant continuation is available
- requires explicit Continue/Open
- starts a fresh valid Gemini Assistant session
- seeds bounded recent conversation/context with current Live client-content semantics
- never claims it is the same underlying socket

## PRIVACY

Transfer is explicit. Do not synchronize every Assistant conversation automatically.

Define consume/delete behavior.

## TESTS

Cover payload versioning, size bounds, same-account ownership, target device routing, malformed payloads, existing text Handoff regression, and new-session reconstruction.

## REQUIRED IMPLEMENTATION REPORT

When complete, create `docs/Assistant-Phases/11-assistant-cross-device-handoff.md` and update `docs/Assistant-Phases/README.md`.

Record the goal, starting state, exact implementation, files changed, model/API/config, schema changes, platform behavior, automated tests/results, manual test procedure, limitations, and next-phase boundary. The report is the permanent truth; do not claim unbuilt behavior.


# MANUAL TEST — PHASE 11

1. On Device A tell Assistant: `The cross-device code word is pineapple seven.`
2. Continue that Assistant task to Device B.
3. On Device B explicitly open the continuation.
4. Ask: `What was the cross-device code word?`
5. PASS if it answers correctly from a new Assistant session.
6. Send a normal plain-text Handoff.
7. PASS if ordinary Handoffs still behave exactly as before.

STOP after this phase.
