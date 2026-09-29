# ASSISTANT BUILD ORDER 14 — Supervised Computer Actions

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

Add controlled computer interaction after Assistant can already understand local and remote context.

Start with deterministic native tools. Add Google's current Computer Use API only where it materially improves unsupported UI interaction.

## SAFETY CLASSES

Separate:

```text
READ
→ screenshot, list apps, window metadata

LOW-RISK ACTION
→ focus/open app, type into confirmed field, copy/paste, simple navigation

HIGH-IMPACT ACTION
→ submit/send, delete, install, shell, credentials, purchases/financial actions
```

High-impact actions require explicit confirmation and some should remain unsupported.

Never expose arbitrary shell execution as a generic Gemini tool.

## DETERMINISTIC TOOLS FIRST

Prefer reliable OS/platform functions for:
- focus/open an allowlisted application
- existing text insertion
- allowlisted keyboard shortcuts
- explicit clipboard actions
- existing Personal Voice tools

Return real success/failure.

## GOOGLE COMPUTER USE

Research current official Gemini Computer Use docs immediately before implementation.

Current design is a screenshot → proposed UI action → execute → screenshot loop and is Preview.

If used:
- keep it as a separate supervised worker invoked by Assistant, not a replacement for `gemini-3.8-live`
- use the currently supported Computer Use model/API
- honor Google's safety decisions
- enable prompt-injection detection where available
- validate all action arguments
- cap steps and wall-clock duration
- expose immediate Stop
- confirm consequential actions
- capture and return post-action state

Do not claim the Live model itself directly controls the mouse if the API actually delegates to another model/Interactions endpoint.

## REMOTE ACTIONS

Remote devices may execute only the same typed validated allowlist after same-account/device checks.

Do not provide remote shell.

## TESTS

Cover safety class, confirmation, cancellation, argument validation, step/time limits, ownership, offline/denied remote device, and real result reporting.

## REQUIRED IMPLEMENTATION REPORT

When complete, create `docs/Assistant-Phases/14-assistant-computer-actions.md` and update `docs/Assistant-Phases/README.md`.

Record the goal, starting state, exact implementation, files changed, model/API/config, schema changes, platform behavior, automated tests/results, manual test procedure, limitations, and next-phase boundary. The report is the permanent truth; do not claim unbuilt behavior.


# MANUAL TEST — PHASE 14

1. Ask Assistant to focus/open an allowed harmless application.
2. PASS if it succeeds and reports the actual result.
3. Ask it to type a harmless phrase into a test field.
4. PASS only if it follows the confirmation rule and lands where intended.
5. Run one supervised Computer Use task in a disposable/test environment, such as locating and clicking a visible harmless button.
6. PASS if required safety confirmation is honored and the resulting screen is verified.
7. Ask for a high-impact action such as deleting a file or submitting sensitive data.
8. PASS if it is blocked or follows the explicit high-impact confirmation policy; silent execution is unacceptable.
9. Verify Stop immediately terminates an active action loop.

STOP after this phase.
