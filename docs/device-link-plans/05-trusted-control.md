# DeviceLink 5/6: Scoped trusted remote-control sessions

**Status:** Planned only. No implementation authorized.
**Working branch:** `plan/device-link-05-trusted-control`
**Merge target:** `feature/device-link-companion-mode`
**Depends on:** PRs 1–4 merged into feature branch; refresh this PR branch before coding.

## Objective
Permit explicitly authorized routine actions on an unattended but running/unlocked PC, without removing the user's safety boundaries or allowing unrestricted remote administration.

### Scope and approach
1. Extend PR 1's pair permissions with a separate **Allow remote control from this device** grant, configured and approved on the target Windows PC. Default OFF; show device identity, current grant, and immediate Revoke/Stop.
2. Issue narrowly scoped, target-specific, expiring grants, bound to the pair and session. Validate server-side and on the Windows receiver. Revoking pairing, disabling remote control, sign-out, or session expiry invalidates further execution promptly.
3. Enumerate the existing safe/reversible action allowlist and risk classes in `computerActions.ts`. Add a narrowly scoped 'trusted session' policy allowing low-risk supported operations to run without a *per-action desktop approval*, but only for that authorized device/session. Keep high-impact operations blocked or requiring separate user confirmation on an available trusted interface.
4. Do not allow the phone or model to self-grant privileges, change the PC policy remotely, or bypass native OS login/unlock. Never auto-run arbitrary shell, file deletion, credentials, purchases, sending mail, installs or unrestricted UI clicking.
5. Ensure reliable action idempotency/claim fencing and revalidation **immediately before execution**, including on retries and after reconnect. Audit/rate-limit accepted/denied requests using metadata only, not command text.
6. Add session lifecycle: start, active, stop, expiry, revoke. A lost phone or stolen session can be cut off by the desktop/device list. Make permission scope easy to understand with minimal progressive disclosure.
7. Keep existing per-action confirmation path as fallback for devices without a trusted session. Reconcile assistantAutoRun/assistantRoutineAutoRun with remoteComputerActions rather than accidentally treating local auto-run as permission for remote devices.
8. Reflect any tool semantic changes through the entire Assistant harness and its tests under `src/assistant/harness/AGENTS.md`.

### Security design gates
- The trust decision is bound to a cryptographically authenticated device pair, not a shared account alone.
- Live grants must expire; stale signed grants are not sufficient after revocation.
- UI content, retrieved pages and AI-generated text are never permission instructions. Tool arguments must be typed and validated.
- If the PC is asleep, locked, offline or its interactive desktop is unavailable, show an honest limitation. No wake/unlock feature in this phase.

### Tests / acceptance gate
- From mobile data, an authorized Android phone runs a permitted action on a running/unlocked desktop with no per-action desktop tap.
- The same action from an untrusted phone, revoked pair, disabled grant or expired session is denied before execution.
- Stop/revoke during repeated requests prevents subsequent actions; retry/reconnect never causes duplicate changes.
- Dangerous requests remain blocked even if Gemini proposes them or the caller has a trusted session.
- Validate foreground Windows lock/offline behavior, real devices, and complete harness/security regression suite before merge.

### Out of scope
Full remote desktop, unsupervised arbitrary GUI interaction, shell/PowerShell, background OS login, wake-on-LAN, privilege escalation.

## Project rules
- Follow `AGENTS.md`, `docs/SPEC.md`, `docs/ARCHITECTURE.md`, and the current implementation before changing code. The checked-in code is authoritative where reports disagree.
- Preserve the single Tauri 2/React/TypeScript app with Windows Rust and Android Kotlin behind platform boundaries. Do not build a second companion app or another AI stack.
- Keep UI minimal, borderless, and accessible. Keep existing dictation, handoffs, clipboard, Assistant, and account sync working.
- Add focused tests, document meaningful architecture decisions, and update README when user-visible capabilities or security change.
- Never claim tests or live-device validation ran until results are recorded.
- This draft PR is **PLAN ONLY**. Do not implement code or migrations until explicitly instructed.

## PR completion report required
When implementation is authorized, report (1) actual changes, (2) automated checks and CI, (3) 3–5 manual tests with expected/actual results, (4) blockers, and (5) readiness to merge.
