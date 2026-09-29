# ASSISTANT BUILD ORDER 08 — Explicit Screen / Window Snapshot Context

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

Let the user deliberately capture visual context and ask Gemini 3.8 Live about it.

```text
Capture screen/window
→ visible preview
→ Ask Assistant
→ image sent to Gemini
→ spoken answer
```

## PRIVACY

- explicit user action only
- visible preview
- remove/detach
- no continuous screenshots
- no periodic background capture
- no screenshot analytics
- no permanent screenshot storage

## WINDOWS

Add reliable native/Tauri capture behind `PlatformAdapter`:
- active window where practical
- screen fallback

## ANDROID

Use the currently supported Android MediaProjection flow.

Do not use AccessibilityService as a screenshot mechanism.

Respect OS permission/consent behavior.

## GEMINI

Verify current Gemini 3.8 Live image input format before coding.

Send the image directly; do not OCR first unless technically required.

Bound image resolution/size reasonably while preserving readable UI context.

## UI

Show thumbnail/preview, source type if known, captured time, Remove, and Recapture.

Do not retain a continuously updating screen in this phase.

## TESTS

Cover permission failure, image encoding, replacement/removal, platform boundaries, size handling, and no disk persistence.

## REQUIRED IMPLEMENTATION REPORT

When complete, create `docs/Assistant-Phases/08-assistant-screen-snapshot.md` and update `docs/Assistant-Phases/README.md`.

Record the goal, starting state, exact implementation, files changed, model/API/config, schema changes, platform behavior, automated tests/results, manual test procedure, limitations, and next-phase boundary. The report is the permanent truth; do not claim unbuilt behavior.


# MANUAL TEST — PHASE 08

### Windows
1. Put a distinctive app/window on screen.
2. Explicitly capture it.
3. Ask: `Describe the application and the most obvious thing visible in this screenshot.`
4. PASS if Gemini correctly describes the captured image.
5. Remove the screenshot.

### Android
Repeat using MediaProjection.

PASS only if capture is explicit, previewed, removable, and usable by Gemini.

STOP after this phase.
