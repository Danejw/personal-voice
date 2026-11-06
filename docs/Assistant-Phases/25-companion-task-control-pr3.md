# PR 3: Companion task control

PR 2's durable Computer Use worker stays the only executor. Android Companion remains the dispatcher.

## Android controls

The selected paired PC's latest persisted Computer Use job shows progress and supports **Pause, Resume, Redirect, Stop**. Redirect is offered only while paused. Gemini Live can invoke the same operations using the existing `remote_computer_goal` or `remote_action` tools. Acknowledgement of a command is never a claim that the goal completed.

All commands use the existing short-lived, signed `device_action_requests` transport and native Windows claim. Unpaired phones, mismatched requesters and expired/replayed commands are rejected. The user must have explicitly enabled remote actions on Windows.

## Safe control contract

Pause updates `computer_jobs.control_state=paused`. A currently executing action can finish, but Windows waits at the next observation/action boundary and continues to heartbeat its existing job lease. Resume releases the same worker. The phone receives the same persistent job ID across voice sessions and app restarts.

A redirect is accepted **only when paused and `phase=observing`**. The original requester must send the signed instruction update. The current Computer Use loop then resets the Gemini interaction ID, discards any unexecuted prior model proposal, captures the current Windows screen again and reasons about the revised goal. It never repeats a native action after ambiguous failure.

When an action is in-flight, redirect is denied. The user may retry at the next safe checkpoint. High-risk desktop steps still require their existing Windows confirmation. No shell or new unsafe capabilities are introduced.

## Backend release order

1. Apply PR 2 `20261109010000_computer_jobs.sql` migration.
2. Apply PR 3 `20261109020000_computer_job_controls.sql` migration.
3. Deploy the matching `supabase/functions/device-pairing/index.ts` Edge Function. Preserve its existing JWT verification configuration.
4. Release the matching Windows and Android applications.

All client control writes fail closed before the matching backend migration and Edge deployment. There are no new tables, services, queues or agent planners in PR 3.

## Acceptance checks

- Unit: signed pause/resume/redirect allowlist and Gemini tool schema; invalid arguments rejected.
- Unit: pause prevents model execution until resumed; mid-reasoning redirect drops the old model action and creates a new interaction from a fresh screen.
- Unit: Windows control is signed and atomic; Companion can read the persisted control state without write permission.
- CI: `pnpm check`, `pnpm eval:tools`, Windows Rust checks/tests, Android debug build and Kotlin tests.
- On hardware: pause during a multi-action goal, confirm no further native actions at the safe boundary; resume and verify it continues.
- On hardware: pause while the model is thinking, redirect the goal, resume and verify the old click is not executed.
- On hardware: revoke pairing, lock the PC, stop the task, restart Android, and confirm accurate durable progress and no false completion.

The existing model carries out the multi-step plan and re-reasons from screenshots. A separate planner and speculative automatic replay are deliberately excluded.
