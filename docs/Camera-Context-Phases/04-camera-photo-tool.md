# Phase 04 — Assistant camera photo tool

## Starting state

`capture_screen` attached `ScreenSnapshot` and sent one `sendVideo` frame per socket. Camera hardware boundaries existed from phases 01–03.

## Files changed

- `src/assistant/cameraPhoto.ts` (+ tests)
- `src/assistant/tools.ts` — `capture_camera_photo`
- `src/assistant/AssistantController.ts` — attach/send/clear
- `src/assistant/state.ts` — `cameraPhoto` attachment
- `src/assistant/AssistantPanel.tsx` — attach UI
- `src/assistant/grounding.ts` — guidance
- `src/assistant/memoryLearn.ts` — reject markers
- Tests: tools, protocol, controller, cameraPhoto

## Architecture

`CameraPhoto` is distinct from `ScreenSnapshot`. Tool → `camera.capturePhoto` → attach → `sendVideo` + camera-specific context note. Cleared on Remove, End, sign-out. Not written to Supabase or message history.

## Deviations

None. Reused `sendVideo` / `realtimeInput.video` without a second transport.

## Tests

Tool parsing (front/back/default/reject), successful capture, no screenshot labeling, clear on end.

## Result

**PASS** (automated). Real-device: **NOT RUN**.

## What works

Saying “take a picture with the back camera” (or using Camera photo in UI) attaches one camera still for the session and sends it once to Gemini Live.
