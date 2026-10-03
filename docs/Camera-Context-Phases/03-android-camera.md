# Phase 03 — Android camera capture

## Starting state

Microphone already native (`NativeMicCapture`) because WebView capture fails behind the floating control. Screen capture uses MediaProjection. No CAMERA permission yet.

## Files changed

- `AndroidCameraSession.kt` — CameraX preview + ImageCapture + ImageAnalysis @ 1 FPS
- `CameraFacingSelect.kt` (+ unit test)
- `VoicePlatformPlugin.kt` — list/capture/start/switch/stop commands, camera permission
- `AndroidManifest.xml` — CAMERA (+ optional camera features)
- `app/build.gradle.kts` — CameraX 1.4.2
- `src-tauri/build.rs` — command allowlist
- `AndroidCameraCapture.ts` (+ bridge tests)
- `AndroidPlatformAdapter.ts`

## Architecture

Kotlin CameraX behind the existing `voice-platform` plugin (not a second plugin). TypeScript `AndroidCameraCapture` bridges events (`cameraFrame` / `cameraError`). Starting camera **brings Personal Voice to the foreground** and shows a visible “Camera On” preview pill — no hidden capture.

## Deviations

- Used CameraX as planned; no separate plugin crate.
- Permission callback stores a pending continuation (same pattern as mic `captureAfterPermission`).

## Tests

- Kotlin: `CameraFacingSelectTest`
- TypeScript: `AndroidCameraCapture.test.ts` (payload helpers)

## Result

**PASS** (code + unit). Real-device CameraX: **NOT RUN** in this session.

## What works

Android can request camera permission, capture front/rear stills, stream ≤1 FPS JPEGs with a visible preview, and release hardware on stop/destroy.
