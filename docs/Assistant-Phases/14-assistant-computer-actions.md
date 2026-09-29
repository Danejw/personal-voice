# Assistant 14 — Supervised computer actions

Prompt: `prompts/assistant-prompts/14-assistant-computer-actions.md`

Branch: `assistant`

## Phase goal

Let Assistant change this computer, and another owned Windows computer, only through a typed allowlist. High-impact actions need confirmation. Shell is not a tool. A screen task that needs clicking uses Google's Computer Use API as a separate supervised worker, not as the Live model moving the mouse.

## Starting state that mattered

Assistant could copy, insert text after confirmation, save a note, send a handoff, and ask another device for a read-only look. It could not open an app, press a shortcut, or click. Dictation was unchanged.

## What shipped

Live tools, each confirmed before it runs:

- `open_app` opens Notepad or Calculator. Any other name is rejected.
- `press_shortcut` presses Copy, Paste, Select all, Undo, Escape, or Tab.
- `insert_text` is unchanged and still confirms before typing.
- `remote_action` asks another owned device to do one of those three. The other device must be online, on this account, a Windows PC, and have **Allow remote actions** on. That PC confirms each request. The default is off.
- `supervise_screen` starts a separate loop. Gemini 3.8 Live does not receive a click tool.

Shell, delete, install, purchase, and credential entry are rejected and are not declared. The remote table's action check is only `open_app`, `press_shortcut`, and `insert_text`.

Computer Use, checked against https://ai.google.dev/gemini-api/docs/computer-use on 2026-09-28, is an Interactions call to `gemini-3.8-flash` with environment `desktop` and prompt-injection detection on. The edge function `computer-step` holds the API key and sets that tool itself. The client validates coordinates, honors `safety_decision` (`require_confirmation` pauses, `blocked` stops), confirms Enter because it can submit, caps the loop at 8 steps and 45 seconds, and shows Stop. Stop is checked before the next step. After a click or typed step, the loop captures the screen again and sends that result back. Drag, mouse-down, and URL navigation are excluded.

A click is a normalized 0–999 point inside the foreground window. Move and scroll are reported as unavailable rather than pretended.

## Files

- `src/assistant/computerActions.ts`, `computerTask.ts`, `computerRemote.ts`, `ComputerActionStore.ts`, `useComputerActions.ts`
- `src/assistant/tools.ts`, `AssistantController.ts`, `AssistantPanel.tsx`, `grounding.ts`, `state.ts`
- `src/services/computerStep.ts`, `computerActionService.ts`
- `src/platform/PlatformAdapter.ts`, Windows and Android adapters
- `src-tauri/src/platform/windows/computer.rs`, `commands/mod.rs`, `lib.rs`
- `src/settings/deviceSettings.ts`, `src/platform/windows/WindowsBehaviorPanel.tsx`
- `src/app/App.tsx`, `src/types/database.ts`
- `supabase/functions/computer-step/index.ts`
- `supabase/migrations/20260929030000_device_action_requests.sql`
- `docs/ARCHITECTURE.md`

## Model, API, and config

Live stays Gemini 3.8 Live. Computer Use is `gemini-3.8-flash` on `POST /v1beta/interactions`. The Live token body is unchanged. `computer-step` is written and not deployed.

## Schema

`device_action_requests` is owned by `user_id` with row level security. Action is one of the three allowlisted names. Argument text is 1–2,000 characters. The migration was applied to the VoiceDictationAPP project.

## Platform behavior

Windows opens the two apps, sends the shortcuts, and clicks. Android refuses desktop actions with a real error. Dictation and the read-only remote look are unchanged. Remote actions stay off until this PC turns them on.

## Tests

`pnpm check` passed: lint, tsc, and vitest (52 files, 334 tests). Coverage includes safety class, allowlist rejection, high-impact confirmation, cancellation, bad coordinates, the step cap, the time cap, Stop before a click, an offline device with no inserted row, another account not reading the row, remote actions off with no execution, a shell request with no execution, and an approved open that stores the real result. `pnpm build` passed. The existing chunk-size warning remains (`index-C-gjNPsQ.js`, about 576 kB). `cargo check --tests` passed.

## Manual test

Not run.

1. Ask Assistant to open Calculator. Confirm. Pass if Calculator opens and Assistant reports that result.
2. Ask it to type a short phrase into a test field. Pass only if it waits for confirmation and the text lands in that field.
3. Ask for one supervised click on a harmless button in a disposable window. Pass if a safety confirmation is honored and the following screen is checked.
4. Ask it to delete a file or run a shell command. Pass if nothing runs.
5. Press Stop during a screen task. Pass if the loop ends before the next action.

The supervised click cannot reach Google until `computer-step` is deployed. The allowlisted open, shortcut, and insert paths do not need that function.

## Limitations

Only Notepad and Calculator can be opened. Shortcuts are the six listed above. Computer Use is preview and is not the Live session. The loop is capped and is not a sandbox VM. Android cannot be the computer that gets clicked. Remote actions cannot click and cannot run a shell. `computer-step` is not deployed, so a live screen task fails at the network step until that function is deployed.

## Next phase boundary

Stop here. Do not start the final audit.
