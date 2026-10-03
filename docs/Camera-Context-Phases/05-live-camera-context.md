# Phase 05 — Live Camera Context

## Starting state

Photo tool and platform frame producers ready. Gemini Live documents max 1 FPS video frames.

## Files changed

- `tools.ts` — `start_camera_context`, `stop_camera_context`
- `AssistantController.ts` — desired-state, frame pump, reconnect resume, cleanup
- `state.ts` — `cameraContextActive` / facing / errors
- `AssistantPanel.tsx` — Camera On / Switch / Stop
- `overlay.ts`, `OverlayDock.tsx`, Android overlay — Camera On indicator
- Tests for start/stop/reconnect/mic coexistence

## Architecture

Explicit `cameraDesired` intent in the controller. Frames → `LatestFrameGate` → `sendVideo`. Not stored as turns or attachments. Reconnect stops hardware then resumes only if still desired; never replays old frames. Microphone session unchanged (no second mic). No hard 2-minute cutoff — sliding-window compression already configured.

## Deviations

- No analytics event added (existing tool-record path can note tool names without imagery).
- Overlay uses a small orange dot + “Camera On” copy rather than a new floating button.

## Tests

Start/stop, end cleanup, reconnect while desired, stop then reconnect stays off, mic remains active.

## Result

**PASS** (automated). Real-device: **NOT RUN**.

## What works

User can turn Camera Context on/off by voice or UI, switch facing, talk concurrently, and see a clear Camera On indicator on Assistant and the floating control.
