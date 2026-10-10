# ASSISTANT BUILD ORDER 04 — Assistant Quick Access

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

Make Assistant usable from the existing background/floating workflows.

Integrate:
- Windows configurable global Assistant shortcut
- Windows always-on-top floating control
- Android floating mic/control

Do not replace Dictation controls.

## WINDOWS KEYBINDING

Add a device-local Assistant binding using the existing hotkey architecture.

It must:
- start/use Assistant, never Dictation
- coexist with Dictate / Note / Handoff / Selection
- use existing conflict validation
- stay local to Windows

## FLOATING CONTROL

Add an explicit Assistant action/mode and surface Assistant states:
- idle
- listening
- responding
- error

Keep it compact. Overlay code emits intent; the shared Assistant controller does the work.

## ANDROID

Give the floating mic/control an explicit way to start Assistant. Do not silently make the existing Dictation press mean Assistant.

Keep business logic shared; Kotlin remains platform plumbing.

## BACKGROUND AUDIO

Verify Assistant responses remain audible while the main Windows window is hidden and while Android uses the floating control. Add only minimal platform support.

## TESTS

Cover keybinding conflicts, mode routing, overlay events, background behavior, and Dictation/Assistant separation.

## REQUIRED IMPLEMENTATION REPORT

When this phase is complete, create:

`docs/Assistant-Phases/04-assistant-quick-access.md`

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


# MANUAL TEST — PHASE 04

### Windows
1. Hide Personal Voice to tray.
2. Trigger Assistant with the new shortcut.
3. Ask: `Say Assistant mode.`
4. PASS if Assistant listens/speaks without opening the main window.
5. End from the floating control.
6. Use normal Dictation hotkey and verify insertion.

### Android
1. Leave the main app.
2. Explicitly start Assistant from the floating control.
3. Ask a question and hear the answer.
4. Switch back to Dictation and dictate into a field.

PASS only if mode selection is obvious on both platforms.

STOP after this phase.
