# ASSISTANT BUILD ORDER 12 — Remote Device Context

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

Allow Assistant on one owned device to explicitly request READ-ONLY context from another owned Personal Voice device.

Examples:

```text
Phone: "What app is open on my desktop?"
Phone: "Show me what Cursor is doing on my desktop."
Phone: "What windows are open on my laptop?"
```

This phase performs no clicks, typing, shell commands, or changes.

## TYPED REMOTE REQUESTS

Create a small authenticated request/response channel.

Initial capabilities:
- presence / last seen
- active application/window name where safely available
- list top-level applications/windows on Windows where practical
- one-time screenshot capture from a remote Windows device

Keep request and response schemas explicit and versioned.

## OWNERSHIP + ROUTING

The requester may target only devices belonging to the same authenticated user.

If multiple eligible devices exist, Assistant must ask/resolve the target rather than guessing.

Remote Personal Voice executes locally and returns bounded results.

Unavailable/offline devices produce a real error.

## SCREENSHOT PRIVACY

Define and implement a clear remote screenshot policy, such as:
- remote-device setting to allow remote reads, plus
- visible notification/approval where appropriate

No continuous live view in this phase.

## PLATFORM SCOPE

Android can be a requester. Do not force symmetrical desktop inspection APIs onto Android when the OS does not expose them cleanly.

## TESTS

Cover ownership, wrong-account denial, routing, offline device, timeout, screenshot lifecycle, read-only guarantee, and bounded payloads.

## REQUIRED IMPLEMENTATION REPORT

When complete, create `docs/Assistant-Phases/12-assistant-remote-device-context.md` and update `docs/Assistant-Phases/README.md`.

Record the goal, starting state, exact implementation, files changed, model/API/config, schema changes, platform behavior, automated tests/results, manual test procedure, limitations, and next-phase boundary. The report is the permanent truth; do not claim unbuilt behavior.


# MANUAL TEST — PHASE 12

1. Keep Personal Voice running on a Windows PC and Android phone under the same account.
2. From the phone ask: `What application is active on my Windows device?`
3. PASS if the answer comes from the remote device rather than Gemini guessing.
4. Ask for a one-time remote screenshot and then ask what is visible.
5. PASS if the screenshot is current, comes from the chosen PC, and follows the implemented permission/notification rule.
6. Verify this phase exposes no modifying remote action.

STOP after this phase.
