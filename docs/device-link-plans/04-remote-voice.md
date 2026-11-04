# DeviceLink 4/6: Phone-driven remote voice actions

**Status:** Planned only. No implementation authorized.
**Working branch:** `plan/device-link-04-remote-voice`
**Merge target:** `feature/device-link-companion-mode`
**Depends on:** PRs 1–3 merged into feature branch; PR 2's channel is available. Refresh this PR branch before coding.

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
- This draft PR is **PLAN ONLY**. Do not implement code or migrations until explicitly instructed.

## PR completion report required
When implementation is authorized, report (1) actual changes, (2) automated checks and CI, (3) 3–5 manual tests with expected/actual results, (4) blockers, and (5) readiness to merge.
