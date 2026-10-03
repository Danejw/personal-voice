# Phase 02 — Windows webcam capture

## Starting state

Phase 01 boundary present. Windows already uses `getUserMedia` successfully for microphones in WebView2 (`BrowserAudioCapture`).

## Files changed

- `src/platform/camera/WebCameraCapture.ts`
- `src/platform/windows/WindowsPlatformAdapter.ts` — `createCamera()` → `WebCameraCapture`

## Architecture

Windows uses TypeScript Web APIs inside the Tauri WebView:

- enumerate `videoinput` devices (after a short permission probe)
- `getUserMedia` with `deviceId` or `facingMode`
- canvas JPEG encode for photos (higher quality) and sampled frames (1 FPS via interval + `LatestFrameGate`)
- tracks stopped and elements released on `stop()`

Native Win32 camera APIs were not required; existing mic path shows getUserMedia is reliable here.

## Deviations

None. No Gemini send in this phase (wired in 04/05).

## Tests

Shared rate-limit/lifecycle logic in `cameraLogic.test.ts`. Real webcam: see phase 06 matrix.

## Result

**PASS** (code + unit). Real-device: **NOT RUN** in this session.

## What works

Windows can list webcams, take a JPEG photo, and produce ≤1 FPS frames without uploading or storing them.
