# DeviceLink 6/6: Usability, regression and real-device sign-off

**Status:** Implementation completed for code-level validation; physical acceptance and backend rollout are outstanding.
**Working branch:** `plan/device-link-06-validation-polish`
**Merge target:** `feature/device-link-companion-mode`
**Depends on:** PRs #36–40 merged into feature branch. This PR is the final integration gate before proposing feature branch -> main.

## Objective
Ship a simple, reliably connected end-to-end experience by validating the complete pairing, companion and remote-voice workflow on real Android and Windows devices.

### Scope and approach
1. Audit all DeviceLink source, settings and migrations after the previous merges. Remove duplicated connection controls, stale labels, redundant sync states and temporary debug UI. Do not redesign unrelated screens.
2. Make first use intuitive: Pair device -> select/default PC -> open Companion Mode -> speak or dictate. Show local/remote/offline accurately but avoid repeated status paragraphs. Add just-in-time prompts for needed Android/Windows permissions.
3. Verify Windows startup/tray persistence, local listener/firewall restrictions, Android battery/background/foreground behavior, device revocation propagation and reconnect after app restart/network switches.
4. Confirm that cursor tracking respects a paused/hidden companion and actual monitor geometry (left/center/right, mixed scale, negative coordinates). Check frame pacing, CPU/battery usage and sensitivity to network jitter.
5. Run complete cross-feature regression: Windows and Android dictation (including remote dictation), handoffs, clipboard, notes, saved Assistant conversation, screenshots and permissions, and UI automation tools.
6. Test cellular remote commands end-to-end with the home computer running/unlocked and correctly permissioned. Verify meaningful receiver outcomes, not just queued requests.
7. Add focused troubleshooting for connection/pairing failure without exposing keys, transcripts, cursor histories or screenshot pixels. Avoid heavyweight telemetry or new analytics infrastructure.
8. Update `README.md`, `docs/ARCHITECTURE.md`, setup/security/privacy docs and any user-visible instructions to match exactly what shipped; do not promise unsupported wake/unlock, streaming or arbitrary remote administration.
9. Document exact tested configurations and remaining gaps before the integration PR into `main`.

### Manual acceptance matrix
- Android + laptop + desktop: pair each and verify reconnection, selecting default and removal.
- Same Wi-Fi: direct connection, character gaze under center monitor, correct cross-monitor movement.
- Cellular: private remote connection and a safe voice command with verified result.
- Untrusted/revoked/expired: no remote action executes; lock/offline reports an honest failure.
- Interruptions: network loss, restart, Android backgrounding, Windows tray, and cancellation do not duplicate or leak actions.
- Regression: ordinary dictation, clipboard, handoffs, notes and Assistant still work on both platforms.

### Quality gate
- `pnpm check`, `pnpm eval:tools` when Assistant tools changed, Windows/Android CI and target-platform Rust/Kotlin builds verified.
- Physical-device tests documented with PASS/FAIL and blockers; no inferred success from unit tests.
- No regressions or unresolved high-severity pairing, authorization, privacy or duplicated-command bugs.
- Draft a final integration PR from `feature/device-link-companion-mode` to `main` **only after** sign-off, not as part of this planning task.

### Out of scope
Any new feature beyond the approved five PRs, major UI redesign, additional device platforms or new backend services.

## Project rules
- Follow `AGENTS.md`, `docs/SPEC.md`, `docs/ARCHITECTURE.md`, and the current implementation before changing code. The checked-in code is authoritative where reports disagree.
- Preserve the single Tauri 2/React/TypeScript app with Windows Rust and Android Kotlin behind platform boundaries. Do not build a second companion app or another AI stack.
- Keep UI minimal, borderless, and accessible. Keep existing dictation, handoffs, clipboard, Assistant, and account sync working.
- Add focused tests, document meaningful architecture decisions, and update README when user-visible capabilities or security change.
- Never claim tests or live-device validation ran until results are recorded.
- Implementation was authorized. Keep the PR a draft until the required physical-device evidence is recorded and the backend release gate is clear.

## PR completion report required
When implementation is authorized, report (1) actual changes, (2) automated checks and CI, (3) 3–5 manual tests with expected/actual results, (4) blockers, and (5) readiness to merge.

## Implemented in PR #41

- Stacked on merged DeviceLink phases #36–40, preserving the integration branch and leaving `main` unchanged.
- Fixed multi-PC Companion privacy/routing: selecting a paired PC is now mandatory when ambiguous, with no fallback after revocation or disconnect. Windows sampling activates for only the chosen PC. Switching sends Stop to the prior target; Android drops stale cursor, monitor and Assistant phase data.
- Added selected-target, stale-frame, missing pairing, hidden-view, reconnect and native listener restart regression tests.
- Serialized Windows native relay shutdown/start to avoid a late stop closing a new listener after rapid restart or account transitions.
- Made optional trusted-control backend failures independent of primary pairing, preserving pairing when trusted grants are not yet deployed.
- Updated README and architecture to describe exact security, UI and backend rollout boundaries.
- Added `docs/device-link-plans/06-acceptance.md` with a detailed physical three-device test matrix, failure triage and release criteria. Each unexecuted test is explicitly `NOT RUN`.

### Release blockers

- Production Supabase still lacks signed-v2 request and trusted-control migrations; current `device-pairing` Edge Function is the older version. Coordinate backend deployment before using updated clients.
- Physical Windows desktop/laptop + Android tests (including Wi-Fi, cellular, multi-monitor, lock, revoke, tray, and regressions) have not been run through connected devices and cannot be counted as passing.
- CI status should be recorded on PR #41's exact head after the latest run; a previous failed run was due to a new test fixture and was corrected.
- Keep this PR draft and do not promote `feature/device-link-companion-mode` to `main` until all acceptance gates are satisfied.
