# DeviceLink 2/6: Local + remote connection transport

**Status:** Implementation underway in draft PR #37. Not yet merge-ready.
**Working branch:** `plan/device-link-02-transport`
**Merge target:** `feature/device-link-companion-mode`
**Depends on:** Current PR #36 implementation is stacked on the PR #37 branch without merging PR #36. Reconcile against the integration branch after PR #36 is accepted.

## Objective
Provide one narrowly scoped device-to-device API that switches between authenticated local communication and private cloud signaling without changing how existing features behave.

### Scope and approach
1. Reuse the pairing/identity contract from PR 1 and audit `src/remote-dictation/remoteDictationFeed.ts`, `RemoteDictationStore.ts`, `computerRemote.ts`, and `remoteContextChannel.ts`. Do not consolidate business rules by deleting working stores.
2. Define a small versioned shared `DeviceLink` contract: sender device ID, target ID, message type, request ID, version, sequence/expiry, payload, and result/acknowledgment. Separate **ephemeral state** (cursor, presence) from **reliable actions** (text, tool requests, confirmations).
3. On Windows use an opt-in Rust local listener with authenticated encrypted WebSocket frames and local mDNS/Bonjour advertisement. On Android discover the service using the platform NSD API; communicate through the existing Tauri/native boundary. Scope firewall binding to the local interface. Validate platform behavior on real devices; avoid embedding permanent secrets in the WebView.
4. Authenticate the local session using the paired device identities, a fresh challenge/ephemeral session key, and authenticated encryption. Validate message type/size/sequence and reject replay, stale sessions and revoked devices.
5. Add private, per-user/per-device Supabase Realtime signaling for remote sessions and event notifications. Explicitly enforce authorization and topic membership; do not trust only client-supplied channel names. Do not stream raw audio or high-rate cursor movement through cloud broadcasts.
6. Preserve existing database/RPC claim-and-ack workflows for reliable actions. Use Realtime as a prompt wake-up signal; on delivery/read, recheck authoritative request row, target identity, expiry and authorization. No new generic distributed queue.
7. Add a small connection manager with states offline / connecting / local / remote / reconnecting, graceful failover, heartbeat/backoff, foreground/background handling and an explicit disconnect.
8. Record only bounded connection diagnostics (no transcripts, keys, screen pixels, cursor histories). Expose a concise transport status where useful in Connected Devices.

### Security and correctness
- End-to-end authenticated message origin and destination; cloud auth and receiver-side grants must both validate.
- Prevent duplicate side effects on reconnect/ack retry using request IDs and existing claim guards.
- On an unreliable network never show success until the target confirms actual execution.
- Treat a network change as a reconnect, not new pairing.
- Avoid WebRTC, tunnel servers, port forwarding, or a separate broker until a proven requirement.

### Tests / acceptance gate
- Paired Android and Windows automatically connect on the same Wi-Fi; local message round trip works after app restart.
- Switching phone to cellular falls back to authenticated cloud signaling; return to Wi-Fi restores local path.
- Verify wrong device/account, forged payload, expired request, replay, loss of connection and revocation denial.
- Verify duplicate remote dictation and tool requests do not execute twice even if delivery repeats.
- Check Android lifecycle and Windows tray/idle behavior on physical devices; existing remote dictation and handoffs do not regress.

### Out of scope
Companion artwork, mouse sampling, new Assistant tools, remote unattended authorization.

## Project rules
- Follow `AGENTS.md`, `docs/SPEC.md`, `docs/ARCHITECTURE.md`, and the current implementation before changing code. The checked-in code is authoritative where reports disagree.
- Preserve the single Tauri 2/React/TypeScript app with Windows Rust and Android Kotlin behind platform boundaries. Do not build a second companion app or another AI stack.
- Keep UI minimal, borderless, and accessible. Keep existing dictation, handoffs, clipboard, Assistant, and account sync working.
- Add focused tests, document meaningful architecture decisions, and update README when user-visible capabilities or security change.
- Never claim tests or live-device validation ran until results are recorded.
- Implementation was explicitly authorized. Keep the PR draft until platform CI, real-device Wi-Fi/cellular transitions, permission behavior and negative security tests pass.

## PR completion report required
When implementation is authorized, report (1) actual changes, (2) automated checks and CI, (3) 3–5 manual tests with expected/actual results, (4) blockers, and (5) readiness to merge.
