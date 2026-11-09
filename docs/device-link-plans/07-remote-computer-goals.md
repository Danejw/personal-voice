# PR45: Android-controlled Windows Computer Use goals

**Status:** Draft for review. Do not deploy the migration, merge or ship before CI and physical-device tests.

## One executor, one remote session

Android's existing Gemini Live Assistant uses the existing `remote_action` tool and Device Link's signed v2 `device_action_requests` transport. A `start_computer_goal` request carries **the whole goal**, not individual clicks. The selected Windows PC prompts **Allow once** for that goal. Once approved, it calls the **existing** `AssistantController.runSupervised()` → `runComputerTask()` → `ComputerActionStore.execute()` loop. The existing Windows screenshot, Interactions API, pointer actions and screen overlay remain authoritative. No second planner, executor, protocol or screenshot transport is introduced.

The signed start request acknowledges acceptance quickly, because `device_action_requests` has a 30-second expiry. A goal may then execute independently inside Windows. The phone asks for status with a *new signed* `computer_goal_status` request (`argument: "current"`) or stops it with `stop_computer_goal` (`argument: "current"`). Status and stop can bypass **per-command PC confirmation** after signature and pairing verification, but only the phone that owns the in-process session can inspect or stop it. They do not create a trusted/unattended grant.

## Boundaries

- Windows must be online, unlocked and explicitly opted in via **Allow remote actions**. Starting a goal requires one Windows approval. Existing one-off pointer requests still require their usual approval.
- Remote goal steps use the existing Computer Use safety decisions. Ordinary clicks and typing proceed automatically; sensitive steps that require approval stop and ask on Windows even if Assistant auto-run is enabled. Blocked commands remain blocked. No arbitrary shell.
- Windows rechecks the phone pairing, account session, remote-control preference and unlocked desktop before each screenshot. Disconnecting the **phone network** alone does not stop already authorized execution, but revocation, sign-out, disabling remote actions or locking Windows does.
- Goal execution is bounded to **240 steps or 30 minutes**, whichever comes first. Normal local Computer Use now allows up to **20 steps/three minutes**, still supervised, cancellable and subject to the same safety gates.
- One Windows executor may run one goal at a time. Progress counts completed actions; the start acknowledgment **does not** assert task completion. Status returns active/failed/completed/stopped and the last action (not screen pixels).
- Computer Use screenshots remain on Windows and travel only along its existing model request path. No screenshots, cursor paths, or task arguments are copied into a new backend state table.

## Important non-goals / follow-up review

**This PR is an initial usable session bridge, not fully durable long-horizon agents.** Sessions and progress are held in the Windows app's memory, so a Windows app restart loses the session. Status is requested on demand, not continuously pushed to Android. Live redirection/editing of an existing goal and checkpoint-based resume after restart or model errors are **not implemented**. Those need a carefully designed persistence and continuation contract, not another Computer Use executor. Before treating this as unattended long-horizon control, review whether to include those contracts in PR45 or split them into the next PR.

## Test after schema migration

1. On Android, pair with the exact Windows device, select **Use for voice**; on Windows, enable **Allow remote actions**.
2. Say “On my laptop, start a computer goal: open Calculator, use it, then open Notepad and write a summary.” Confirm once on Windows. Verify several visible actions execute without more ordinary mouse confirmations.
3. On Android, ask for the goal's progress, then stop it. Verify the signed status changes to stopped and Windows takes no additional steps.
4. Revoke pairing, lock the desktop, or sign out while a goal is running. Verify no more actions occur after the currently executing step and that the goal fails/stops.
5. Try an unpaired phone, a different paired phone, another overlapping goal, and a high-risk submission. Verify owner isolation, one-active-goal enforcement and Windows high-risk confirmation.

**Release gate:** Windows and Android CI, `pnpm check`, `pnpm eval:tools`, real-device execution and revocation tests. No manual pass claimed by automated tests.
