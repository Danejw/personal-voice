# Durable Computer Use: execution contract and implementation plan

## Product contract

A user can say from Android, "On my laptop, complete X." Android Gemini Live is the conversational **dispatcher**, not the executor. The target Windows PC owns the persistent job, visual observation, Computer Use proposals, native actions, checkpointing, verification, and recovery. Phone voice sessions may end without cancelling the job. Reconnecting to the Companion must show the same job and its real status.

Never tell the user "done" because a tool call was accepted, a click returned success, a model stopped producing function calls, or a time/step limit was hit.

## Lifecycle

`queued -> running -> verifying -> completed`
`running -> waiting_for_user -> running`
`running -> recovering -> running`
`running/recovering/verifying -> needs_review | blocked | failed | cancelled`
`running -> interrupted` when the Windows executor is lost; never silently mark it completed.

Each job has one stable id, user/target/requester device ids, goal, status, current step, meaningful progress, checkpoint and evidence references, last verified observation, lease owner/heartbeat, last error, created/updated timestamps and an append-only event history. The phone sees these persisted facts, not remembered voice responses.

## PR sequence

### 1. Truthful results and verification (this PR)

- The Windows Computer Use loop returns typed `verified`, `unverified`, `stopped` or `blocked` outcomes.
- Model narration and a signed start receipt are not completion.
- Capture a **fresh** screenshot after the model proposes stopping and perform a separate, read-only visual postcondition check. If it cannot visibly substantiate the goal, label it `needs_review`, never `completed`.
- On stop/time cap/step cap show work already done. Do not say "Nothing further was done" after side effects.
- Explicitly teach Android voice responses that the goal start acknowledgement is not proof of success.

### 2. Durable job registry and device worker

- Add a persisted `computer_jobs` record and append-only `computer_job_events` per request, with user-only read permissions and **signed Windows identity** for status transitions.
- Use a Windows-owned background worker with a lease and heartbeat independent of the Gemini Live voice session and the Companion UI.
- Checkpoint step count, model interaction reference, current screen context and last **verified** postcondition after each step or group. Do not persist raw screenshots by default.
- On PC restart, reconcile a stale lease as `interrupted`; reconcile current screen before safe resume. Never replay a click, submit or payment just because a previous acknowledgment was lost.
- Separate `accepted`, `executing`, `verifying` and `completed`. The source of truth is the worker job, not the phone's last tool response.

### 3. Companion job controls and confirmations

- Present a persistent Companion job card with live progress, last action, recent observation, and `Pause / Resume / Stop`.
- Read the same job after Android reconnects or the voice session restarts. Send notifications only for complete, blocked, or needing user input, not every cursor movement.
- Route sensitive-operation confirmation back to the **originating paired phone** with signed, expiring request/response and explicit user consent. If the phone cannot approve, pause instead of waiting for a PC-side click.

### 4. Autonomous recovery and evaluations

- Worker loop: observe -> reason -> act -> observe -> verify -> checkpoint. Model tool calls are proposals; runtime validates arguments and security.
- Retry **idempotent observations** on transient errors, with bounded backoff. Never blindly replay side effects. On model failures, reconcile screenshot and application state first.
- Detect stalls, identical repeated actions, focus changes and inconsistent screenshots; ask for help with actionable evidence rather than fabricating progress.
- Run a device-level benchmark: launch Chrome, navigate tabs, create/save/read back a file, use a multi-app workflow, disconnect phone mid-job, restart voice session, lock desktop, revoke pairing, crash/restart worker, recover after timeouts and distinguish unverified from complete.
- Gate release on long-running **hardware** tests as well as Windows/Android CI. Track success rate, false-completion rate, recovery rate and time-to-completion.

## Constraints

The Windows machine must be reachable, running an authorized worker, and able to interact with its desktop. Locked/sleeping sessions cannot be assumed controllable. Device pairing controls access; user approval for genuinely sensitive external actions must not be bypassed. The system must report this limitation clearly rather than pretending it completed remotely.

**This PR is milestone 1 only. It does not yet implement durable job persistence, background-service recovery or phone-side confirmations.**
