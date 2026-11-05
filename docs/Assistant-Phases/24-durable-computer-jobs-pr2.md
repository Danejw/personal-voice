# PR 2: Durable Computer Use jobs

## Scope

One persistent `public.computer_jobs` table, the existing `computer_task_events` Flight Recorder, and the current Windows Computer Use executor. No new agent framework, event bus, or background Windows service.

## Execution contract

Android sends the existing signed `start_computer_goal` request. Windows verifies the request and atomically creates a durable job from the exact original request before acknowledging it. Only after acknowledgment does Windows activate the job lease and start the existing model/screenshot/native-action loop. If job creation fails, the request is denied and no desktop action runs.

The job is owned by the signed-in user but **may only be mutated by the cryptographically verified Windows device** through the existing `device-pairing` function and service-only `computer_job_mutate` RPC. Android only reads job state with owner-scoped RLS. A receipt or model claim is not a completed job.

Each side-effecting action is fenced:
1. Verify the PC is unlocked, remote actions remain enabled, pairing is current, and the worker lease is valid.
2. Persist `phase=applying` and the current step index **before** any mouse/keyboard action.
3. Execute that native action at most once.
4. Persist `phase=observing`, updated step index and action label **before** proceeding.
5. Independently verify the result with a fresh screenshot. Only a verified report with nonempty visual evidence can commit `completed`.

A signed heartbeat renews the lease while an external model request is in flight. If the lease is lost, pairing is revoked, the PC locks, or the user signs out, the worker stops before further actions.

## Startup recovery

On Windows app restart, one signed reconciliation checks the durable active job. A previously running goal with **zero actions and an observing checkpoint** may restart from a fresh screenshot when the desktop is unlocked and remote control is still enabled. A checkpoint at `applying` becomes `needs_review` because the last action's outcome is uncertain. Other progressed or unacknowledged jobs become `interrupted` and never replay actions automatically.

The current local crash journal remains a cache, not the source of truth. Android Companion reads the latest durable job even after its own voice session closes or the app restarts. `Update` and `Stop` continue using the existing signed request protocol; new pause/redirect UX belongs in PR 3.

## Deployment

**Before shipping a PR 2 client build:** apply migration `20261109010000_computer_jobs.sql`, then deploy the updated `supabase/functions/device-pairing/index.ts` preserving `verify_jwt=true`. The client intentionally fails closed if these backend changes are absent. Do not deploy this migration or Edge function separately before the matching client is ready.

## Acceptance

- Unit regressions: pre/post-action ordering, failed pre-commit executes no action, failed post-commit does not repeat action, signed job creation/lease, and restart with an uncertain action outcome.
- CI: `pnpm check`, `pnpm eval:tools`, Windows Rust checks/tests, Android build/Kotlin tests.
- On hardware: start a multi-step goal on Android, end its voice session, and confirm Windows continues to verify a result.
- Force-stop/restart Windows app **before any native action**, then verify safe zero-action restart. Repeat **after an action has started** and confirm `needs_review` with no replay.
- Disconnect/reconnect Android and check the persisted job and truthful final status. Lock PC or revoke pairing mid-job and confirm it stops before another action.

**Not in PR 2:** automatic replay of ambiguous actions, reliable work on locked/powered-off PCs, planner/autonomy upgrades, new Companion control modes, or persistent raw screenshots.
