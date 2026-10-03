# Phase 06 — UX, safety, validation

## Starting state

Phases 01–05 implemented on `main` worktree.

## Files changed

- Phase docs under `docs/Camera-Context-Phases/`
- `docs/SPEC.md`, `docs/ARCHITECTURE.md`, `docs/ANDROID.md`, `README.md`
- UI polish already in Assistant panel + overlay (borderless)

## Automated checks

| Check | Result |
| --- | --- |
| `pnpm lint` | **PASS** |
| `pnpm typecheck` | **PASS** |
| `pnpm test` | **PASS** (468 tests) |
| `pnpm build` | **PASS** |
| `cargo fmt --check` | **FAIL** (pre-existing formatting drift in unrelated Windows Rust files; this phase only touched `build.rs`) |
| `cargo check --locked` | **PASS** |
| `cargo clippy -D warnings` | **FAIL** (pre-existing clippy lints in Windows overlay/snapshot/push_to_talk; not introduced by camera) |
| Android/Kotlin unit tests | **NOT RUN** (ANDROID_HOME / sdk.dir missing in this environment) |

## Manual matrix — Windows

1. Default webcam photo — **NOT RUN**
2. Alternate webcam — **NOT RUN**
3. Start Camera Context — **NOT RUN**
4. Talk while camera active — **NOT RUN**
5. Ask about changing camera content — **NOT RUN**
6. Stop Camera Context, Assistant stays — **NOT RUN**
7. Restart Camera Context — **NOT RUN**
8. End Assistant while camera active — **NOT RUN**
9. Deny camera permission — **NOT RUN**
10. Unplug webcam mid-session — **NOT RUN**
11. OS camera indicator off after stop — **NOT RUN**
12. No media saved — **NOT RUN**

## Manual matrix — Android

1–13 as specified in the implementation plan — **NOT RUN** (requires device/emulator with CameraX).

## Cross-feature regression

Automated suite covers Assistant tools, overlay snapshot, dictation state machines already in repo. Physical regression of dictation/echo/screenshots — **NOT RUN** on device in this session.

## Remaining blockers

- Real-device Windows webcam + Android CameraX validation.
- Confirm WebView2 camera permission UX on a clean Windows profile.
- Confirm Android foreground transition from floating Assistant voice “turn on the camera.”

## What works (software)

Users can request camera photos and live Camera Context through Assistant tools/UI on Windows (getUserMedia) and Android (CameraX), with ephemeral JPEG frames to Gemini Live at ≤1 FPS and no Personal Voice persistence.
