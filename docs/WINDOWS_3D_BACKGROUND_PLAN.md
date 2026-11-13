# Windows 3D desktop background prototype

Status: experimental prototype implemented; automated checks and a bounded native
smoke test passed. Visual/lifecycle/voice acceptance remains pending. Created 2026-11-12 on
`codex/3d-background`, based on `feature/device-link-companion-mode` at
`0f0969aab30955aa10bd58c131009cd9b2cf103a`. The pre-existing untracked
`package-lock.json` is outside this task and must be preserved.

## Outcome and scope

Use the running Personal Voice Windows app to host a persistent, real 3D world
behind desktop icons and ordinary windows. Three monitors show contiguous sections
of one world with one consistent perspective; never repeat a complete scene on each
screen. Closing Settings keeps the background alive through the existing tray app;
quitting Personal Voice removes it. This is an experimental Windows feature in the
existing Tauri 2 app, not a separate application or a replacement for voice flows.

First milestone: prove desktop hosting and a continuous cross-monitor scene.
Later milestones may add objects and eventually allow entry into the same world
through a VR headset. Objects, interaction, VR/WebXR integration, headset support,
scene synchronization, and new Assistant tools are outside this prototype.
VR compatibility is not yet verified; separating scene content from desktop hosting
preserves an option for reuse without claiming it already works.

Visual direction: a futuristic perspective wireframe room/hallway. Local reference:
`C:/Users/RecallableFacts/Desktop/futuristic-3d-wireframe-room-perspective-grid-futuristic-digital-hallway-space-virtual-reality_322958-803.avif`.
The file exists but has not been decoded or visually reviewed for this plan. Decode
and review it during implementation before interpreting its colors or geometry.
Build real geometry with Three.js after the host proof; do not use the image as a
flat wallpaper or require that machine-specific path at runtime.

Updated user direction: the supplied cyan rolling mesh PNG was visually reviewed.
The implemented default is original triangulated cyan terrain with soft luminous
points and depth fog, rather than hallway walls. The reference image, watermark,
and browser chrome are not bundled. Objects and VR remain deferred.

## Prototype implementation and execution evidence

- Separate `background.html` / `src/desktopBackground/` entry never imports the app,
  auth, microphone, or Assistant controllers. Three.js and its types are pinned to
  `0.187.0`. Scene content is independent of native desktop hosting.
- `src-tauri/src/platform/windows/desktop_background.rs` discovers the wallpaper
  WorkerW behind an icon host and creates native child windows through Tauri's
  `parent_raw`. Reparenting a previously top-level window failed the first probe;
  native child creation repaired the lifetime failure. No process DPI changes.
- Chosen prototype strategy: one physical-pixel surface per monitor, each using
  `PerspectiveCamera.setViewOffset` into one global frustum and identical deterministic
  world content. This avoids one enormous spanning framebuffer and per-window DPI
  scaling of global coordinates. A real spanning-window comparison is still pending;
  this is a prototype choice, not a claim that the alternative was benchmarked.
- Windows Devices & Controls contains the enable/disable switch. State is native
  `disabled/starting/running/error`, off on each app launch. Persistence is intentionally
  deferred until lifecycle acceptance passes. Shell/monitor loss or a long power-time
  gap stops rendering and requires explicit re-enable; there is no retry loop.
- Windows-only commands validate the caller; renderer app IPC permits only its
  readiness/error report. Other app commands are rejected at the invocation boundary.
- Rendering is static/on demand; resources and contexts are disposed on teardown.
  Layout and camera-projection tests cover three displays, negative origins, mixed
  DPI, vertical offsets, portrait bounds, and monitor gaps. No frame animation loop.
- Passed `pnpm check` (762 passed, 1 skipped; 2 test files skipped), `pnpm eval:tools`
  (21 passed, 1 skipped; offline corpus only), and `pnpm build`. Build reports large
  bundle warnings. Windows `cargo check --locked` and Rust library tests passed
  (43 tests); the filesystem emits incremental-cache hardlink warnings.
- Native smoke runner: debug executable with `--desktop-background-smoke-test`.
  It uses a separate app identifier, no Settings/tray/auth/voice setup, and exits
  after testing. The installed Personal Voice app was left running.
  On Windows 10 Pro (Explorer `10.0.19041.6159`), native monitor bounds were
  `(-2560,159,2560,1440)`, `(0,0,2560,1440)`, `(2560,264,1920,1080)`, all scale 1.
  After 12 seconds: `running`, three ready surfaces, no renderer error. The watchdog
  independently checked live HWND parentage/layout. Foreground HWND was unchanged;
  disable returned `disabled`, and one second later zero background windows remained.
- Still unverified: visual desktop-icon z-order/seams, desktop mouse interactions,
  real mixed DPI (the native test was all 100%), Explorer restart, lock/unlock,
  actual sleep/wake, display changes, GPU/resource measurements, and live voice
  coexistence. Android compilation/CI has not run here. Automated passes do not
  substitute for those manual tests; this experiment is not ready to merge.
- Browser preview: run `pnpm dev`, open
  `http://localhost:1420/background.html?preview`. This is a scene preview, not desktop
  embedding. The actual native smoke runner is separate.
- Local interactive runner: debug executable with `--desktop-background-review`.
  It keeps the actual desktop surfaces running beside the installed voice app,
  with a separate tray icon for Enable, Disable, and Quit background test. It uses
  the same renderer/host as the application; it does not start a second voice stack.

Official API references reviewed: [Tauri window builder](https://docs.rs/tauri/latest/tauri/webview/struct.WebviewWindowBuilder.html),
[Windows SetParent/DPI caveats](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setparent),
and [Three.js view offsets](https://threejs.org/docs/#api/en/cameras/PerspectiveCamera.setViewOffset).
WorkerW/message `0x052c` is an undocumented Explorer convention, not an official
Windows wallpaper-host API; unsupported shells fail closed.

## Existing integration points (inspected)

- `src-tauri/src/lib.rs`: single-instance setup, tray startup, window-specific event
  handling, hidden main window on close/minimize, and exit cleanup.
- `src-tauri/src/tray.rs`: Open, floating control, Pause dictation, and Quit.
- `src/main.tsx`: selects main, indicator, or computer activity view by window label.
  A background view must have a distinct entry path and must not mount `App` or
  create a second dictation/Assistant controller, auth loop, or microphone owner.
- `src/platform/index.ts`, `src/platform/windows/WindowsPlatformAdapter.ts`, and
  `src-tauri/src/platform/{mod.rs,windows/mod.rs}`: current platform boundary.
  Native desktop hosting belongs in a focused Windows module behind this boundary.
  The floating control's topmost placement is a different behavior, not a host proof.
- `src/platform/windows/WindowsBehaviorPanel.tsx` and
  `src/settings/deviceSettings.ts`: candidates for Windows-only enable/disable and
  local preference integration; no account or cloud scene storage is needed.
- `src-tauri/tauri.conf.json`, `src-tauri/capabilities/`, and
  `src-tauri/src/commands/mod.rs`: review new-window configuration and command access.
  Existing WebView background-throttling flags require an explicit rendering budget.
- `package.json` has no Three.js dependency. `src-tauri/Cargo.toml` already contains
  Windows API bindings. Review exact API needs before adding features/dependencies.
- `.github/workflows/validate.yml` defines Windows checks/Rust tests and an Android
  debug APK build/Kotlin tests. Keep Android compilation and behavior intact.

The current request is the planning prompt. Read `AGENTS.md`, `docs/SPEC.md`,
`docs/ARCHITECTURE.md`, and `docs/PV-Phases/README.md` before implementation; this
experiment does not imply that skipped PV phases have been completed.

## Sequenced task list

The original acceptance gates below remain unchecked where full native/manual
acceptance has not been demonstrated. The evidence above records partial progress.

### 1. Prove native desktop hosting with a simple diagnostic scene

- [ ] Verify current official Windows/Tauri/WebView APIs and isolate any shell
  hosting technique (including any Progman/WorkerW approach) as an experimental,
  potentially undocumented dependency. Record tested Windows/shell versions.
- [ ] Create a Windows-only, non-activating background surface in the existing
  process. Use a simple diagnostic grid first; no Three.js installation at this gate.
  Restrict any new IPC to its intended window; do not expose voice/native actions
  to a renderer that needs only scene/layout data.
- [ ] Prove z-order behind desktop icons and normal windows, desktop click/context
  menu/drag behavior, taskbar/Alt-Tab exclusion, and no focus stealing. Fail safely
  if no suitable shell host exists; preserve the normal desktop and voice app.

Acceptance: native inspection plus a recorded desktop smoke test proves actual
shell hosting, not merely a low-z-order ordinary window. Disable and Quit remove
the surface without changing wallpaper settings or leaving an orphan window.

### 2. Choose and prove the monitor layout/projection strategy

- [ ] Inventory physical monitor rectangles, negative virtual-desktop origins,
  DPI scale, rotation, resolution, gaps, and ordering. Keep coordinate spaces explicit;
  do not combine logical offsets with physical pixel sizes.
- [ ] Compare one spanning surface against coordinated per-monitor surfaces on the
  actual three-monitor setup. Record shell-parenting constraints, renderer size/GPU
  limits, DPI transitions, seam quality, and resource cost; choose the smallest
  approach that passes. Do not assume a spanning WebView handles mixed DPI correctly.
- [ ] Define one world/camera and virtual viewport. If multiple surfaces are needed,
  derive off-axis view sections from the same projection and shared scene state/time;
  never give each screen a full independent camera view. Document the initial flat
  virtual-plane assumption; angled-panel physical calibration remains unproven.
- [ ] Add deterministic layout/projection tests: negative origins, mixed DPI,
  unequal resolutions, portrait screens, gaps, and adjacent view boundaries.

Acceptance: diagnostic lines and landmarks continue across all three monitor edges
with no duplicated room, restarted vanishing point, or DPI-dependent offset.
Unit tests support the mapping; real monitor observations prove presentation.

### 3. Render the wireframe room as reusable 3D content

- [ ] After gates 1–2 pass, add a pinned Three.js dependency only as needed. Keep
  scene geometry/material/camera construction separate from Windows HWND hosting,
  React settings, account services, and monitor discovery.
- [ ] Build a simple room/hallway with floor, walls, depth, and stable perspective.
  Use the approved reference as visual direction after reviewing it. Share world
  state between views if multiple renderers are necessary; avoid a new framework.
- [ ] Handle renderer/context failure and dispose geometry, materials, contexts,
  subscriptions, and rendering loops on disable or teardown.

Acceptance: real depth geometry renders as one continuous environment; a development
camera adjustment confirms geometry/parallax. No interactive objects or VR work.

### 4. Integrate controls, rendering budget, and lifecycle recovery

- [ ] Add an off-by-default Windows enable/disable control using existing settings
  patterns, with local preference and clear failure state. Use an explicit small
  lifecycle (disabled/starting/running/recovering/error), not unrelated booleans.
- [ ] Preserve the tray/single-instance lifecycle. Background stays when Settings
  hides, and enable/disable is repeatable. Keep Android free of Windows host windows,
  dependencies, and controls through compile/platform boundaries.
- [ ] Render a static scene on demand; schedule frames only for actual changes.
  Measure CPU/GPU/memory with voice idle and active, set/document an animation frame
  budget only if animation is added, and pause when suspended/locked or safely
  detected as fully occluded. Do not infer visibility solely from Settings being hidden.
- [ ] Recover or safely disable after Explorer restart, display disconnect/reconnect,
  primary/scale/resolution changes, lock/unlock, sleep/wake, and renderer loss.
  Bound retries and prevent duplicate hosts/loops; clean up on Quit and update exit.

Acceptance: lifecycle transitions are covered by focused state/cleanup tests plus
native smoke tests. No busy retry loop, focus theft, leaked host, or sustained redraw
for an unchanged scene; record measured costs and hardware rather than claim a budget
has passed without measurements. Failure does not stop existing voice behavior.

### 5. Validate and document the experimental milestone

- [ ] Run `pnpm check`, `pnpm eval:tools`, `pnpm build`, and Windows
  `cargo check --locked --manifest-path src-tauri/Cargo.toml` /
  `cargo test --locked --manifest-path src-tauri/Cargo.toml`. Use existing CI to verify
  the Android build/Kotlin tests. Report pending or unavailable checks explicitly.
- [ ] Run the five-step manual test below and attach machine/layout, native host
  evidence, seam captures, lifecycle results, and resource measurements.
- [ ] Update README and relevant architecture/setup docs in the implementation PR
  once capabilities or setup change. Include changes, CI/test status, expected manual
  results, unresolved issues, and merge readiness. Planning alone needs no README churn.
  No harness changes are planned because no Assistant declaration, executor, permission,
  or context semantics change; reassess under the mandatory workflow if that scope changes.

## Manual acceptance test (future implementation; not run)

1. Enable on three monitors, with one left/above the primary (negative coordinates)
   and mixed DPI/resolutions. Compare grid/room landmarks at seams: one continuous
   perspective, no cloning, correct coverage, and no stretched/restarted sections.
2. Open/close/minimize Settings; move ordinary apps between screens; use Show desktop,
   icons, desktop context menu, taskbar, and Alt-Tab. Expect the world to remain behind
   icons/windows, desktop input and app focus unchanged, and Settings close to keep it alive.
3. Dictate into an editor using configured hotkeys and floating control; cancel a
   dictation; start/stop voice and typed Assistant interaction. Expect normal insertion,
   cancellation, playback/microphone ownership, and unchanged approval behavior.
4. Restart Explorer, unplug/reconnect a monitor, change primary/resolution/DPI, then
   lock/unlock and sleep/wake. Expect correct reattachment/layout or an explicit safe
   disabled/error state, with desktop and voice usable and no duplicate surfaces.
5. Leave the scene idle and measure rendering cost, then disable/re-enable repeatedly,
   launch the app again, and Quit from tray. Expect low/on-demand idle rendering,
   one app/host set, released renderer resources, and the normal desktop after Quit.

## Unresolved proof requirements

### MediaPipe parallax extension

Implemented opt-in local webcam tracking in a dedicated control window, a CPU
MediaPipe worker, Center/Stop/strength/reversal controls, bounded normalized eye
midpoint/apparent-size movement, a single native smoothing relay, and off-axis
monitor projections. MediaPipe is pinned to `1.2.3`; the version-1 model and license
are bundled with provenance under `public/mediapipe/`. No Assistant tool changed:
these are restricted application IPC commands, not Gemini declarations. The
Assistant's existing capture/permission/context pipeline is unchanged. Head tracking
does not use its JPEG frame path, microphone, backend, or saved conversations.

Automated evidence: `pnpm check` passed 766 tests (existing skips remain), tool evals
passed 21 tests with one skip, production build passed, Rust library tests passed
44 tests. These cover calibration bounds, camera-frustum consistency for moving
eyes, and native command access/pose validation. Real camera accuracy/latency,
stop/start races with a driver, resource measurements, and Android builds still need
device verification. No merge readiness is claimed.

Windows execution evidence: the debug tester's camera-off probe successfully
initialized the bundled MediaPipe module-worker runtime and completed inference on
a synthetic 640×480 frame. The initial classic-loader attempt failed with
`ModuleFactory not set`; selecting the pinned package's matching ES-module loader
and WASM fixed it without modifying vendor code. This proves local runtime/model
execution, not human tracking accuracy or motion-to-display latency. The tracker
targets at most 25 samples/second with one inference in flight. Real camera testing
is left to the Start camera control; no webcam was opened for the synthetic probe.

Manual test for this extension:

Follow-up from live testing: the user observed movement on the outer screens but
an apparently frozen center. Native pose delivery targets all scene windows;
the rendering callback previously waited for `requestAnimationFrame`, which a
covered WebView may suspend independently. The scene now draws directly on each
bounded pose event. A regression test suspends animation callbacks and verifies
movement and stale-pose reset on each of the three monitor indices. This reproduces
and fixes the scheduling failure in tests; confirmation on the user's center screen
is still required. Retry with a normal app covering/restoring the center desktop.

1. Open Head tracking from the tester tray; expect camera off. Start camera and
   allow the OS request yourself if prompted; expect a live preview and local tracking.
2. Press Center while sitting normally, then lean left/right/up/down and slightly
   toward/away. Expect depth/parallax across one continuous three-monitor scene.
   Adjust strength/reversal if needed; monocular depth remains approximate.
3. Cover/leave the camera view. Expect the scene to settle to center, with no stale
   movement; return and Center again if the seated position changed.
4. Stop, restart, close the tracker, and disable/re-enable the background. Expect
   webcam release on stop/close/disable, centered views, and no duplicate camera owner.
5. While tracking, exercise dictation and Assistant audio. Expect normal audio and
   insertion. Test Assistant camera separately; stop tracking first if the driver
   cannot serve both capture sessions. Repeat monitor/lifecycle tests above.

Desktop shell hosting/recovery, WebView behavior behind icons, three-monitor mixed-DPI
presentation, physical perspective on angled displays, and performance require native
evidence. No host strategy or VR compatibility is established by this document.
Implementation was subsequently authorized. Stop at this experimental prototype;
do not commit, push, open a PR, or expand into objects or VR without another request.
