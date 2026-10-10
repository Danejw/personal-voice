# Assistant 15 — Final audit

Prompt: `prompts/assistant-prompts/15-assistant-final-audit.md`

Branch: `assistant`

## Phase goal

Audit the finished Assistant system, correct stale product docs, and leave Dictation on Gemini 3.5 Transcribe Live. No new feature.

## Starting state that mattered

Phases 01–14 were already in the tree. Dictation and Assistant were separate pipelines. Product docs still said Live declared only four tools, and `docs/SPEC.md` still listed assistant mode as something not to build.

## What the audit found

Dictation stays behind `DictationController`. That file does not mention Assistant. The two modes share one microphone through `MicrophoneLease`. An Assistant failure releases that lease. The capture format is still PCM16 mono 16 kHz. No second audio pipeline was added.

The permanent Google key stays in `gemini-token` and in the undeployed `computer-step` function. The client stores neither the key nor the Live resumption handle. Tokens are not written to logs or disk. Screenshots and microphone audio stay in memory. A Live screenshot is sent once per socket. Later questions reuse it.

Search is a session tool the model may use. It is not attached to every turn. A quota close retries once without Search. Personal context is clipped at 2,000 characters. Notes and one handoff share an 8,000-character budget. Remote reads and remote actions time out after 30 seconds. The Computer Use loop stops after 8 steps or 45 seconds, and Stop is checked before the next step.

Every Live tool goes through `decideToolCall`. Copy and a remote read run immediately. Insert, notes, handoffs, opening an allowlisted app, shortcuts, a screen task, and a remote action wait for Confirm. Shell, delete, install, and purchase are rejected. Remote rows are limited to the signed-in user by row level security, and the client also filters by user id. An offline device does not get a row.

No Assistant package was added. Windows-only checks in the app shell choose the floating control, the toast, and the Windows settings panel. Android refuses desktop actions with an error. The dev-only Reconnect button is not in a production build. The status line says Listening or Responding. Attached selection, notes, handoff, and screenshot stay visible. Search sources appear on the reply that has them. Confirm, Cancel, and Stop are on the Assistant page.

No obsolete path was removed. The existing tests cover the replacement behavior, and nothing unused was safe to delete without changing a working path.

## What changed

Docs only:

- `docs/SPEC.md` — Assistant is a second mode. Meeting recording, billing, teams, extra transcription providers, offline ASR, and public store distribution stay out of scope.
- `docs/ARCHITECTURE.md` — the tool list matches the code. The audit report is linked.
- `docs/BACKEND_SYNC.md` — Search-quota retry, the two device-request tables, and the undeployed `computer-step` function.
- `docs/Assistant-Phases/README.md`

## Files

- `docs/SPEC.md`
- `docs/ARCHITECTURE.md`
- `docs/BACKEND_SYNC.md`
- `docs/Assistant-Phases/README.md`
- `docs/Assistant-Phases/15-assistant-final-audit.md`

## Model, API, and config

Unchanged. Dictation is Gemini 3.5 Transcribe Live. Assistant conversation is Gemini 3.8 Live. Computer Use, when the function is deployed, is `gemini-3.8-flash` on the Interactions API. `computer-step` is still not deployed.

## Schema

None in this phase. `device_context_requests` and `device_action_requests` were already applied.

## Platform behavior

Unchanged. Windows can open Notepad or Calculator, press the allowlisted shortcuts, and click during a supervised task. Android can dictate, talk to Assistant, and request a remote read or action. It cannot be the computer that is clicked.

## Tests

`pnpm check` passed: lint, tsc, and vitest (52 files, 334 tests). `pnpm build` passed. `cargo check --tests` passed. No application code changed, so no new unit test was added.

## Manual test

Not run.

1. Dictate on Windows and confirm the text lands in the focused app.
2. Dictate on Android and confirm the text lands in the focused field.
3. Start Assistant from the shortcut or the floating control, without opening the main window on Windows.
4. Hold a short spoken conversation.
5. Interrupt a spoken reply.
6. Attach a selection and ask about that exact text.
7. Ask Assistant to create a note and confirm.
8. Ask a current question and look for sources on that reply only.
9. Capture the screen and ask two follow-ups without a second capture.
10. Continue the task to a second device on the same account.
11. Ask the other device what window is open, with remote reads on.
12. Ask which device the analytics say is used most, with the profile on.
13. Ask to open Calculator and confirm.
14. Press Stop or End.
15. Dictate again immediately.

Pass only if Dictation still inserts text and the two modes stay distinct. Step 13 does not need `computer-step`. A click task does, and that function is not deployed.

## Limitations

The on-screen transcript grows for the life of the session. The model window is compressed, and a continuation package keeps at most 12 turns. Live Google Search still depends on quota. `computer-step` is not deployed. This audit did not run the manual list on a device.

## Next phase boundary

Stop. This build order has no further Assistant phase.
