# Assistant 10 — Notes and handoff context

Prompt: `prompts/assistant-prompts/10-assistant-notes-handoffs-context.md`

Branch: `assistant`

## Phase goal

Let the user deliberately attach existing Personal Voice data to Assistant:

- one or more selected Notes
- one selected or pending Handoff

Do not dump the whole account into Gemini.

## Starting state that mattered

Assistant already kept an attached selection and one screenshot for the current session. Notes and Handoffs already load through their authenticated stores. Neither list had an attach action. Ending Assistant while idle does nothing, so a note attached before Start would have survived sign-out if only `end()` ran. Dictation, the token body, and the note and handoff tables were unchanged.

## What shipped

The user attaches specific rows from the Notes and Handoffs pages. Assistant copies the id, text, and time into memory. Up to 8 notes, and one handoff. Notes plus that handoff share an 8,000-character budget. A ninth note, a duplicate, an empty item, or a total over the budget is refused and the count is shown. Attaching another handoff replaces the previous one.

The Assistant page lists each attached note and the handoff with a short preview and Remove. The source lists use the same control: Attach to Assistant, or Remove from Assistant when that row is already attached.

A running session is told about each item once per socket, as source material. A typed question also carries the current attachments as a separate part from the instruction. Removing an item tells the session that item is no longer active context, without repeating its text. Text already sent on that socket cannot be unsent. End is the clean break.

Attaching does not archive, edit, delete, or dismiss the saved row. There is no second context database. Sign-out clears attachments even when Assistant is idle. Offline attach uses the rows already on screen. It does not fetch.

## Files

- `src/assistant/accountContext.ts` — limits, copies, and the context and detach notes
- `src/assistant/AssistantController.ts` — attach, detach, sign-out clear, and the typed-turn part
- `src/assistant/state.ts` — `notes`, `handoff`, `accountError`
- `src/assistant/protocol.ts`, `AssistantSession.ts` — optional account part on a typed turn
- `src/notes/NotesPanel.tsx`, `src/handoffs/HandoffPanel.tsx`, `src/components/HoverActionItem.tsx` — attach control
- `src/assistant/AssistantPanel.tsx`, `src/app/App.tsx`
- `src/assistant/accountContext.test.ts`, `AssistantController.test.ts`
- `docs/ARCHITECTURE.md`

No token, database, or dictation change.

## Model, API, and config

Unchanged. Gemini 3.8 Live. The token still locks only the model. Search still retries once without `googleSearch` when quota closes the socket with 1011.

## Tests

`pnpm check` passed: lint, tsc, and vitest (46 files, 300 tests). The new tests cover two notes plus one handoff on a typed turn, the duplicate and size caps, detach so the next turn omits the removed note, a frozen source left unchanged, idle sign-out clearing the attachment, and a failure leaving it in place. `pnpm build` passed. The existing chunk-size warning remains.

## Manual test

Not run.

1. Create two short Notes with different facts. Attach both. Ask `Summarize the two attached notes and tell me how they differ.` Pass if both notes are used.
2. Detach one. Ask a question only the removed note could answer. Pass if it is no longer active context.
3. Attach a received Handoff and ask for a summary. Pass if that text is used.
4. Confirm the source note and handoff rows are unchanged: not archived, deleted, or dismissed.

## Next phase boundary

Stop here. Do not start cross-device handoff, memory, or computer control.
