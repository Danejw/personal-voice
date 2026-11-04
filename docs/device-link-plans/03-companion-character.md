# DeviceLink 3/6: Android Companion Mode

Status: Implementation started in draft PR #38. Not merge-ready until physical-device validation.
Working branch: `plan/device-link-03-companion-character`
Merge target: `feature/device-link-companion-mode`
Dependencies: PR #36 and PR #37 are merged into the DeviceLink integration branch. PR #38 is based on that merged code.

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
## Implementation record

- Vector companion page in the existing Android app, with a sparse full-screen layout, monitor placement selector, animated eyes, states and existing Assistant start/end control.
- Native Windows `companion_pointer_sample` reports virtual-desktop physical coordinates plus individual monitor rectangles. No accessibility or screen read is performed.
- New strictly validated local-only DeviceLink frames: companion start/stop, display layout and assistant state. Cursor data uses the existing authenticated encrypted local transport and never cloud wake signaling.
- Windows sends pointer data at most every 80 ms only for connected paired phones that explicitly request Companion Mode. Android renews consent while the view is visible; hiding or exiting sends stop. Consent expires if renewal stops.
- Negative origin and mixed-display calibration tests, protocol frame validation, and assistant-state transition tests included.
- Reuse of the existing Assistant controller, not an independent voice provider.

## Manual acceptance gates (outstanding)

1. Pair physical Windows + Android devices, open Companion on the phone and verify cursor tracking in three monitors with different DPI/resolutions and a monitor left of the primary.
2. Exit or background the phone view. Confirm Windows no longer samples/transmits pointer updates, and gaze becomes neutral after disconnection.
3. Verify idle, listening, thinking and speaking modes and that a tap starts or stops the *existing* Android assistant only once.
4. Disconnect/reconnect Wi-Fi and revoke the pair. Confirm no cloud cursor fallback and no stale cursor movement.
5. Measure Android device frame pacing and battery consumption. Confirm accessibility reduced-motion behavior.

Do not merge until Windows and Android CI pass and hardware acceptance is verified.
