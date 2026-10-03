# Camera Context Phases

Personal Voice Assistant can use the device camera as conversational context.

## Flow

```text
User (spoken / UI)
  → Assistant tool (capture_camera_photo | start_camera_context | stop_camera_context)
  → AssistantController
  → CameraCapture (PlatformAdapter.createCamera)
  → Windows WebCameraCapture (getUserMedia) or Android CameraX (Kotlin plugin)
  → JPEG frame
  → AssistantSession.sendVideo
  → Gemini Live realtimeInput.video (image/jpeg, ≤ 1 FPS)
```

## Privacy

- Camera activates only from explicit user intent (spoken request, tool call, or UI action).
- OS camera permissions remain authoritative.
- Frames go device → Gemini Live; Personal Voice backend does not receive the stream.
- Frames are not persisted, not stored in Assistant messages, not uploaded to Supabase, and not fed into memory learning.
- Analytics may record non-content events only (never imagery or descriptions).

## Phase reports

| Phase | Report | Status |
| --- | --- | --- |
| 01 Foundation | [01-camera-foundation.md](01-camera-foundation.md) | Implemented |
| 02 Windows | [02-windows-camera.md](02-windows-camera.md) | Implemented |
| 03 Android | [03-android-camera.md](03-android-camera.md) | Implemented |
| 04 Photo tool | [04-camera-photo-tool.md](04-camera-photo-tool.md) | Implemented |
| 05 Live context | [05-live-camera-context.md](05-live-camera-context.md) | Implemented |
| 06 Validation | [06-camera-validation.md](06-camera-validation.md) | Automated checks; real-device pending |

## Gemini Live notes (verified 2026-10-03)

- Video is discrete JPEG/PNG frames via `realtimeInput.video`.
- Documented maximum is **1 FPS**.
- Audio and video share one Live session.
- Existing `contextWindowCompression.slidingWindow` and session resumption remain; no hard 2-minute Camera Context cutoff was added.
