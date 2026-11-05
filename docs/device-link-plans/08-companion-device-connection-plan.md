# PR1 plan: Seamless paired-device connection

Status: planning only. Do not implement, deploy, or merge from this document.

## Product outcome
From Android Companion, select one paired Windows PC, have a fluent Gemini Live conversation, dispatch commands over the already-authorized device connection on home Wi-Fi or cellular, receive truthful status, and reconnect automatically without re-pairing. No computer goal persistence in this PR; PR2 owns that.

## Existing implementation to reuse
- Existing account/device registration, QR or temporary-code pairing, server-validated device signatures, private keys in Android Keystore and Windows CNG, and PC-authorized remote action grants.
- Existing DeviceLink encrypted LAN transport and cloud wake/signaling, plus signed v2 `device_action_requests` with authoritative signed Windows receipts.
- Existing Android Companion selection of exactly one PC, gaze subscription over local Wi-Fi, existing Gemini Live Assistant and remote_action tool.
- Existing security boundaries: Windows remote actions opt-in, explicit device target, revocation, locked-PC refusal, no raw audio or screenshots through Supabase.
- Existing physical acceptance document `docs/device-link-plans/06-acceptance.md`; all P1-P12 tests recorded NOT RUN there and must not be presented as validated.
- Phase 17's verified completion work is parallel; accepted/queued commands do not mean completed goals.

## Before implementation: source audit
Inspect current implementation and tests for pairing, DeviceLink discovery/handshake, cloud signaling, remote actions, Companion device selection, Android lifecycle, and Windows availability. Identify exact code paths and migrations. Compare main with any open in-flight DeviceLink/Computer Use PRs and do not reimplement already-shipped paths. Write a gap matrix marking implemented/tested/missing, backed by source code.

## Planned changes
1. Keep QR pairing and account-backed device identity. If current pairing already satisfies reconnect, use it unchanged. Explicitly surface one selected target and offline/locked/unpaired states with no silent target fallback.
2. Make delivery choose encrypted local DeviceLink when reachable; use the existing signed cloud request/wakeup path for low-bandwidth commands, replies and status when remote. Treat cloud as control plane, not a continuous screenshot/audio/cursor-stream relay. Do not require a new generic websocket service.
3. Add bounded retry/reconnect and deduplicate by stable request ID at the Windows execution boundary. Restore pending status after Android background/foreground or network switch; never replay a side-effecting request merely because its reply was lost.
4. Preserve current Gemini Live audio connection directly to provider. Phone remains conversational dispatcher. Keep PC worker interface small: target ID, request ID, action/goal, authorization proof, signed accepted/rejected/result/status.
5. Handle Windows sleeping/offline/locked/revoked clearly. No bypass of approval or grant rules. Maintain one explicit target per Companion session. Local gaze remains local-only and only while the Companion is visible.
6. Keep changes limited to actual audit gaps; avoid a new pairing protocol, framework, planner, event bus, second backend or replacement tool API.

## Protocol and security acceptance
- Device and account ownership verified server-side; requests bound to sender, target, expiry, and idempotency identifier; replay/tamper/revocation rejected.
- Android cannot report command completion from enqueue/accept alone; only signed executor outcome may substantiate execution, and PR2 adds goal-level verification.
- Authenticated remote connectivity on different networks works without port forwarding. No permanent API keys on phone; no microphone/audio stream routed through relay.
- PC local preference and session locking remain authoritative; sensitive tools keep existing confirmation gates.

## Tests and evidence
- Unit/integration: pairing refresh, signature failure, wrong target, expiry, duplicate ID, cloud wake delivery, concurrent requests, lost acknowledgement, client restart, network change and revoke.
- Physical: Android and two Windows PCs; QR pair/restart; select exact PC; Wi-Fi then cellular; PC offline/locked; switch networks; reconnect; verify actual signed outcome.
- Run `pnpm check`, `pnpm eval:tools`, and Windows/Android CI when implementation PR lands. Record physical build, date, devices and pass/fail, never claim physical validation from CI.
- Manual review: pair phone to two PCs; select laptop and open Calculator via voice; move to cellular and repeat with authorized target; restart Companion and inspect target and last receipt; revoke laptop and confirm refusal.

## Dependencies and boundary
PR1 must not rewrite the Phase 17 computer use execution loop, introduce a job table, or implement long-running jobs. PR2 builds durable execution on top of existing signed routing. PR3 adds seamless conversational control. Plan PR only: no runtime changes, no tests run, not ready to merge as a feature.
