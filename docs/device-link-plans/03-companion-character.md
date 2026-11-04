# DeviceLink 3/6: Android Companion Mode

Status: Planning only. No feature code is authorized.
Working branch: `plan/device-link-03-companion-character`
Merge target: `feature/device-link-companion-mode`
Dependencies: Pairing and DeviceLink transport plans.

## Goal

Create an optional companion view in Personal Voice for Android. When the phone is placed below the center monitor, its animated character responds to Windows mouse location and existing assistant states.

## Implementation plan

1. Inspect the current Android Tauri app, native overlay, assistant lifecycle and Windows pointer-position utility. Reuse the shared app rather than making a separate companion application.
2. Add a minimal fullscreen companion view with simple vector eyes and states for idle, listening, thinking and speaking. Existing Android microphone behavior stays authoritative.
3. Add a Windows-only pointer stream independent of the current Assistant pointer-awareness sampling. Publish location updates only while a paired local companion session is active.
4. Report monitor rectangles and virtual desktop coordinates. Normalize the pointer location relative to a configurable phone position, defaulting to below the center display. Handle monitors left of the primary monitor and mixed scaling.
5. Deliver lightweight coordinate updates through the local DeviceLink channel. Animate eye direction smoothly on Android between updates. Do not send screen images or application content as part of gaze tracking.
6. Stop updates when the companion is hidden, disconnected or revoked. Resume gracefully without accumulating a pointer log.
7. Keep the UI sparse: one companion character, voice activation, a small current-device indicator, and a clear exit.

## Tests and acceptance

- A physical Android phone follows the pointer correctly across a three-monitor Windows setup.
- Placement calibration and mixed-resolution layouts give the correct gaze direction.
- Assistant state changes update the character without starting a duplicate voice session.
- Hiding the companion stops the pointer stream; disconnecting restores a neutral expression.
- Windows/Android build and regression checks pass. Actual frame pacing and battery impact are measured on a phone.

## Non-goals

Remote mouse manipulation, screen streaming, camera tracking, a new AI provider, a separate Android product.

## Repository rules

Follow AGENTS.md, docs/SPEC.md, docs/ARCHITECTURE.md, and current code; implement no changes until instructed. When implementation begins, record actual changes, tests, physical-device checks, blockers and merge readiness.