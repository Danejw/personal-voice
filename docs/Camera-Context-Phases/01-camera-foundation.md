# Phase 01 — Camera foundation and architecture

## Starting state

HEAD `3f2351d` on `main`. Assistant already had `sendVideo` / `assistantSnapshotFrame`, screen snapshots, and `PlatformAdapter.createCapture()` for microphones. No camera boundary existed.

## Files changed

- `src/platform/camera/types.ts`
- `src/platform/camera/CameraCapture.ts`
- `src/platform/camera/cameraLogic.ts` (+ tests)
- `src/platform/camera/UnavailableCameraCapture.ts`
- `src/platform/camera/index.ts`
- `src/platform/PlatformAdapter.ts` — `createCamera()`
- Windows/Android adapters wired in later phases

## Architecture

`CameraCapture` mirrors `AudioCapture`: a small platform interface with `listDevices`, `capturePhoto`, `startFrames`, `switchCamera`, `stop`. Shared helpers cover facing parsing, 1 FPS clamping, JPEG validation, device resolution, and `LatestFrameGate` (newest frame wins). Screen capture and microphone capture stay separate.

## Deviations

None material. `switchCamera` is on the interface from the start because front/back switching is required later and fits cleanly.

## Tests

`cameraLogic.test.ts` — facing, FPS clamp, JPEG validation, latest-frame gate, device resolution.

## Result

**PASS** (unit). No Gemini wiring in this phase.

## What works

Shared camera types and platform boundary are in place. Platforms can implement `createCamera()` without Assistant knowing WebView or CameraX details.
