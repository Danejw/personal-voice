# Assistant 12 — Remote device context

Prompt: `prompts/assistant-prompts/12-assistant-remote-device-context.md`

Branch: `assistant`

## Phase goal

Let Assistant on one owned device explicitly request read-only context from another owned Personal Voice device. This phase performs no clicks, typing, shell commands, or changes.

## Starting state that mattered

Devices already record a name, platform, and `last_seen` for the signed-in account. Handoffs move text. Assistant can capture one local screenshot. There was no way for one device to ask what is on another device's screen. Dictation was unchanged.

## What shipped

Assistant has a read-only tool, `read_remote_device`. The kinds are `presence`, `active_window`, `windows`, and `screenshot`. If more than one other device is online and the user did not name one, the tool asks which device. It does not guess. A device whose `last_seen` is missing or older than 45 seconds is reported offline and no request is sent.

Requests go through `device_context_requests`. The target device polls about every 4 seconds, refreshes its own `last_seen`, and answers locally. The row is deleted after the requester reads the answer, a denial, or a 30 second timeout.

On this PC, **Allow remote reads** is off until the user turns it on. While it is off, window and screenshot requests are denied and nothing is captured. While it is on, the active window and a list of up to 20 visible window titles are returned. Settings is hidden first so the title is the app underneath, not Personal Voice. A screenshot still needs **Allow once**. A Windows notification says the request arrived. Denying, or letting it time out, captures nothing. There is no repeating capture and no live view.

Android can ask. Android cannot list windows or take a remote screenshot; those requests are denied with a real error.

The tool result is text. A screenshot is also attached to the new session as one still image, the same way a local capture is. The model is told not to guess what is open on the other device.

## Files

- `supabase/migrations/20260929020000_device_context_requests.sql`
- `src/types/database.ts`
- `src/assistant/remoteContext.ts`, `remoteContextChannel.ts`, `RemoteReadStore.ts`, `useRemoteReads.ts`
- `src/services/remoteContextService.ts`
- `src/assistant/tools.ts`, `AssistantController.ts`, `grounding.ts`
- `src/settings/deviceSettings.ts`, `src/platform/windows/WindowsBehaviorPanel.tsx`
- `src/platform/PlatformAdapter.ts`, Windows and Android adapters
- `src-tauri/src/platform/windows/windows_info.rs`, `commands/mod.rs`, `lib.rs`
- `src/app/App.tsx`, `src/handoffs/useHandoffAlerts.ts`
- Tests in `remoteContextChannel.test.ts`, `tools.test.ts`, `AssistantController.test.ts`, `protocol.test.ts`
- `docs/ARCHITECTURE.md`

## Model, API, and config

Gemini 3.8 Live is unchanged. The new declaration is synchronous and has no click, type, or shell action. The token body is unchanged.

## Schema

`device_context_requests` is owned by `user_id` with row level security, same as handoffs. Version is fixed at 1. Kind is one of the four reads. Response text is capped at 400,000 characters. The migration was applied to the VoiceDictationAPP project.

## Platform behavior

Windows answers window reads and, after Allow once, one screenshot. Android answers presence when it is online and refuses window and screenshot reads. The overlay and dictation hotkeys are unchanged.

## Tests

`pnpm check` passed: lint, tsc, and vitest (48 files, 311 tests). Coverage includes several devices asking for a name, a device that is not on the account, an offline last-seen, another account not seeing the row, timeout and row deletion, remote reads off with no capture, Android refusing windows, screenshot waiting until approval, a screenshot that is too large, and the tool running without insert or send. `pnpm build` passed. `cargo check --tests` passed. The existing chunk-size warning remains.

## Manual test

Not run.

1. Keep Personal Voice running on a Windows PC and an Android phone on the same account.
2. On the PC, turn on **Allow remote reads**.
3. From the phone ask: `What application is active on my Windows device?`
4. Pass if the answer names the window on that PC.
5. Ask for a one-time screenshot. On the PC, choose **Allow once**. Ask what is visible.
6. Pass if the image is from that capture and is not a live view.
7. Confirm there is no remote click, type, or other change.

## Limitations

The other device must be running Personal Voice. A hidden PC still answers window reads only when remote reads are on. The window list is titles, not process names, and stops at 20. Allow once has about 30 seconds before the request times out. Screenshot pixels are not kept in the table after the requester reads them.

## Next phase boundary

Stop here. Do not start memory or computer control.
