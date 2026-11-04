# DeviceLink 4/6: Phone-driven remote voice actions

**Status:** Implementation underway in draft PR #39. Not merge-ready until CI, secure migration deployment and real-device tests.
**Working branch:** `plan/device-link-04-remote-voice`
**Merge target:** `feature/device-link-companion-mode`
**Depends on:** PRs #36 and #37 merged; this branch is stacked on the current PR #38 companion implementation without merging PR #38.

## Objective
Route commands spoken to the existing Android Gemini Assistant to the selected paired Windows computer, with real execution outcomes and current safeguards intact.

### Scope and approach
1. Audit actual `src/assistant/tools.ts`, `AssistantController.ts`, `ComputerActionStore.ts`, `computerRemote.ts`, `remoteContextChannel.ts`, `src/services/computerActionService.ts`, and platform adapters. Historical reports are not authoritative.
2. Support explicit target selection by **device ID** with a remembered default. If the device is ambiguous or offline, ask/return a clear failure. A selected target must never silently fall back to another PC.
3. Connect existing remote-action and read-only-context tools to DeviceLink's reliable request/ack delivery. Reuse existing allowlisted actions and screenshot approval rather than making a second executor. Keep ordinary remote dictation a separate user intent.
4. Make voice commands such as 'open Calculator on Desktop', 'type this in the current field' or 'what app is active on Laptop?' use the same Gemini Live conversation on the phone. Return structured accepted / denied / executed / failed results and read back only verified results.
5. Any actual change to Assistant tool definitions, permissions, supported platforms or semantics must update **all** required harness layers in the same PR: `src/assistant/tools.ts`, `toolIntelligence.ts`, impacted playbooks/contextAssembler, `toolResults.ts`, evaluation fixtures and tests, per `src/assistant/harness/AGENTS.md`. Do not add a redundant planner.
6. Preserve PC approval requirements currently in place. This PR does NOT silently enable unattended execution; that is PR 5. Remote screenshot requests remain explicitly consented and bounded.
7. Respect the current Android foreground microphone/bubble design and normal assistant turn cancellation. Never route raw microphone audio through Supabase.

### Security and failure handling
- Validate target membership, device pairing, origin, action type, arguments, permissions and expiry on target, not just on phone.
- Reject shell, credential entry, installs, purchases, destructive actions and arbitrary computer-control tools not already authorized.
- User-visible confirmation of task success requires actual receiver evidence, not just message delivery.
- Safe cancellation, timeout, duplicate suppression and errors should not leave stale requests that execute later.

### Tests / acceptance gate
- Android can talk to a named/selected Windows PC and open an approved app, press a permitted shortcut, insert text, and read its active window.
- A request targeting laptop never executes on desktop, and multiple targets remain disambiguated.
- Local and cellular connection cases succeed through the same command path, subject to existing user approvals.
- Offline PC, revoked trust, denied permission, expired request, cancellation and duplicate delivery produce truthful failures.
- Run `pnpm check`, `pnpm eval:tools`, Windows/Android CI, and real-device Assistant tests. Add negative harness evaluation scenarios for new/changed behavior.

### Out of scope
Persistent unattended control, broad GUI agents, shell execution, wake/unlock, new transcription providers.

## Project rules
- Follow `AGENTS.md`, `docs/SPEC.md`, `docs/ARCHITECTURE.md`, and the current implementation before changing code. The checked-in code is authoritative where reports disagree.
- Preserve the single Tauri 2/React/TypeScript app with Windows Rust and Android Kotlin behind platform boundaries. Do not build a second companion app or another AI stack.
- Keep UI minimal, borderless, and accessible. Keep existing dictation, handoffs, clipboard, Assistant, and account sync working.
- Add focused tests, document meaningful architecture decisions, and update README when user-visible capabilities or security change.
- Never claim tests or live-device validation ran until results are recorded.
- Implementation has been authorized. Keep the PR as a draft until security, CI, hardware and regression gates have passed.

## PR completion report required
When implementation is authorized, report (1) actual changes, (2) automated checks and CI, (3) 3–5 manual tests with expected/actual results, (4) blockers, and (5) readiness to merge.

## Implementation record

- Extended existing Gemini `remote_action` and `read_remote_device` arguments with optional exact `device_id`; a per-phone saved default is used only when the user does not name a PC. Duplicate names, offline targets and missing pairings fail rather than choosing another PC.
- Android Devices pairing UI now offers **Use for voice** for a verified paired Windows device. The selected device ID stays local to that phone.
- New `remoteVoiceProof` cryptographically binds request ID, source and destination device IDs, action/read kind, argument hash and signed responder outcome to PR #36 device identities. Sender verifies the PC's signed outcome instead of treating transport delivery as execution.
- Preserved existing `ComputerActionStore` allowlist, Windows approval, `RemoteReadStore` screenshot consent, and reliable original database request/ack flow. DeviceLink only provides a wake signal.
- SQL migration `20261105010000_remote_voice_proofs.sql` adds signing fields, 30-second expiry, immutable commands, one-way responses and paired-device RLS policies. This migration has been tested in a rollback-only transaction and has NOT been applied.
- Added target selection, signature binding, Gemini argument, and harness regression tests. No new Gemini planner or executor was added.

## Outstanding acceptance

- Green Windows, Android, `pnpm check`, `pnpm eval:tools` against current head
- Security review and application of migration only after app rollout is safe
- Real signed pair validation on Android phone and Windows PC, same Wi-Fi and cellular
- Explicit PC confirmation, receipt verification, real screen observation and application launch
- Wrong PC, ambiguous names, revoked pairing, offline, denied, expired, duplicate and cancelled requests
- Check legacy remote request compatibility and safe upgrade rollout

**Do not merge or enable the backend remotely until these gates are completed.**
