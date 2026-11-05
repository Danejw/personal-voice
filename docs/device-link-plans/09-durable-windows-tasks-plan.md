# PR2 plan: Durable Windows-owned Computer Use execution

Status: planning only. Depends on reviewed PR1 contracts and the existing Phase 17 truthful-results work. No new agent planner.

## Product outcome
From Android Gemini Live, start one whole goal on an explicitly paired Windows PC. Windows owns the model's existing reasoning/tool loop, so the task continues after the phone's voice session ends. On reconnect, the same job returns accurate status and evidence. No fabricated completion.

## Existing code to reuse
- `docs/device-link-plans/07-remote-computer-goals.md`: existing `start_computer_goal`, `computer_goal_status`, `stop_computer_goal` over signed `remote_action` / DeviceLink `device_action_requests`; Windows `AssistantController.runSupervised()` → `runComputerTask()` → `ComputerActionStore.execute()`.
- Current one-at-a-time Windows Computer Use loop, screenshot observations, Interactions API, tool permissions, visible cursor and PC approval contract.
- `docs/Assistant-Phases/17-durable-computer-use-worker.md` truthfulness milestone: distinct verified/unverified/stopped/blocked and post-action verification. Do not assume that branch is merged or working until audited.
- Existing account identities, authorization, approval and revocation. Windows process and unlocked interactive desktop constraints.
- The existing Assistant tool harness registry, validation, playbooks, metrics and evals must remain in sync with any modified tool.

## Source audit before changes
Inspect the exact production implementation, branch/PR differences, active remote goal session storage, stop/status handlers and model continuation. Confirm which Phase 17 improvements are on main. Locate existing persistence and transport facilities before adding a schema or worker. Do not build another Computer Use executor or planning engine.

## Planned changes
1. Minimal durable job record keyed by stable job ID, requester and target identities, status, original goal, last committed action index, last meaningful observation, model continuation reference if valid, timestamps and failure reason. Prefer existing backend/storage and avoid a generalized workflow engine.
2. The Windows runtime, *not Android Gemini Live*, owns the reasoning model's multi-step tool calling. Gemini Live immediately receives accepted with job ID and remains free to converse. Acceptance is not success.
3. Add independent Windows process task runner/host lifecycle with one active desktop control goal per Windows device. It must survive Android disconnection. On Windows app exit/crash/reboot, persist checkpoint and reconcile as interrupted. Only resume when app/user session is available and previously executed side effects have been reconciled.
4. Keep `observe → model/tool calls → execute → observe → verify` within existing runComputerTask and tool adapters. Do not implement custom task decomposition/plans. Prefer existing native tools where supported; runtime validates every model-proposed action and platform permissions.
5. Save only concise status/evidence metadata by default, not screenshots or microphone audio. Signed Windows update is authoritative. Use `queued / running / verifying / completed / waiting_for_user / interrupted / blocked / failed / cancelled / needs_review` as useful states without pointless duplicates. Confirm exact lifecycle before schema.
6. Implement pause/resume/cancel as idempotent control requests with correct owner authorization. On task update/redirection, coordinate with PR3 and append instructions to the existing task only at safe interruption points.
7. Recovery must not replay uncertain clicks/submissions. Bounded retry for observations; restart from fresh visual/structured state and request review if state cannot be reconciled.
8. Locks, sign-out, revoked pairing, expiry, disabled remote control, off PC or sleeping session must block desktop actions honestly; no privileged service attempting to bypass secure desktop.
9. Preserve local Computer Use behavior and ongoing Phase 17 verification fixes; avoid arbitrarily lowering current security protections.

## Clear ownership
- Phone: Gemini Live conversation, task creation and control/status requests.
- Windows: one authoritative task state, execution loop, trusted evidence, progress and safe recovery.
- Backend: identity-bound durable job metadata and event publication as needed; not a second executor, planner or screen/audio proxy.

## Test gates
Automated: duplicate delivery/idempotency, interruption after side effect, corrupted checkpoint, reconnect, ownership, revoke, locking, pause/stop, model failure, false completion, stale heartbeat, two competing goals; harness parity tests for any tool edits.
Hardware: 15+ minute multi-app task; Android session disconnect then reconnect; worker/app restart; locked Windows; unpair while running; PC stays offline; verification of a newly created/read-back file.
Run `pnpm check`, `pnpm eval:tools`, Windows/Android CI and document physical pass/fail per hardware and commit SHA. No false claim of successful unattended multi-hour execution until physical evidence exists.

## Dependencies / out of scope
PR1 supplies reliable paired routing. PR3 owns conversational nonblocking status/redirection UX. Do not replace Gemini Live, add LangGraph/Temporal, a general queue/event bus, a new model provider, or a new planner. No background execution on a powered-off PC or locked interactive session.
Planning-only: no implementation, migrations or tests run. Not a functional release.
