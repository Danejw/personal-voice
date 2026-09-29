# Assistant 06 — Safe actions

Prompt: `prompts/assistant-prompts/06-assistant-safe-actions.md`

Branch: `assistant`

## Phase goal

Give Gemini 3.8 Live a small explicit tool set backed by capabilities Personal Voice already owns:

```text
Gemini requests a typed tool
→ Assistant validates the arguments
→ confirmation policy
→ existing clipboard, insert, voice-note, or handoff service runs
→ the real result goes back to Gemini with the same function-call id
```

## Starting state that mattered

Assistant already had a Live session, voice, interruption, quick access, and attached selections. A `toolCall` message was refused and the session failed. Voice notes, handoffs, clipboard paste, and copy already existed outside Assistant. `DictationController` was left unchanged. The token function was not modified and was not deployed.

## What shipped

Live setup now declares four functions. Declarations omit `behavior`, so calls stay synchronous: Gemini waits for `toolResponse` before it continues. That matches the Live tools guide checked on 2026-09-15. The same page says asynchronous function calling is not supported on Gemini 3.1 Flash Live, and `scheduling` (`INTERRUPT`, `WHEN_IDLE`, `SILENT`) applies only to non-blocking responses. This phase does not send either field.

| Tool | Confirmation | What runs |
| --- | --- | --- |
| `copy_text` | No. The Assistant page says "Copied to the clipboard." | `navigator.clipboard.writeText` |
| `insert_text` | Yes | Existing `platform.insertText` (the same paste dictation uses) |
| `create_voice_note` | Yes | `VoiceNotesStore.create` |
| `send_handoff` | Yes | `HandoffStore.send` to a resolved device id |

`replace_selection` is not declared. Capture stores text and an optional app name, not a field range. Windows insert pastes into whatever is focused now. Android replaces a selection only while that field is still focused. After a conversation that focus is gone, so a replace would write into the wrong place.

Arguments must be an object (a JSON object string is accepted). `text` must be a string, non-empty after trim, and at most 8,000 characters. Extra fields are ignored. An unknown name, including `replace_selection`, is rejected. A call with no id is ignored and does not run. The tool response uses the original id and name. Success is `{ result }` only after the service resolves. Failure and cancel are `{ error }` and do not include `result`.

Confirmation copy:

```text
Assistant wants to:
Send this text to Desktop

[Confirm] [Cancel]
```

Insert says "Insert this text into the focused app." A voice note says "Save this voice note." Handoff uses the device name from `resolveHandoffDevice`: the requested `device` name, or the target already selected in Handoffs. No match, more than one match, or no selected target rejects the call before a confirm card. Confirm calls the existing send and does not change the saved target.

Cancel tells Gemini "The user cancelled. Nothing was changed." and does not call the service. A second mutating call while one is waiting is rejected with "Another action is already waiting for confirmation." End, failure, and reconnect drop a waiting action without reporting success. An in-flight confirm that outlives that session does not send a result on the next socket.

The card is on the Assistant page. The Android floating panel has Confirm and Cancel. The Windows floating stack grows by 76px and shows the same two buttons while an action is waiting. The Assistant button tooltip includes the pending title.

## Files

- `src/assistant/tools.ts` — declarations, argument checks, confirmation policy
- `src/assistant/protocol.ts` — setup tools and `toolResponse`
- `src/assistant/AssistantSession.ts`, `AssistantController.ts`, `state.ts`, `AssistantPanel.tsx`
- `src/handoffs/handoff.ts`, `HandoffStore.ts` — resolve a target and send to an explicit device id
- `src/app/App.tsx` — wires the existing services
- `src/overlay/overlay.ts`, `useOverlay.ts`, `OverlayDock.tsx`, `overlayConfirmSpace.ts`
- `src-tauri` overlay pin — `resize_overlay_confirm` adds height for the two buttons
- `src-tauri/gen/android/.../OverlayPanelView.kt`
- `docs/ARCHITECTURE.md`

No token or database change.

## Model, API, and config

Same `gemini-3.8-live` socket. Tools are client setup fields, like session resumption: the assistant token lock does not list them. If Google treats `liveConnectConstraints.config` as a full replacement, these declarations would not apply until the token changes. That was not verified live.

Wire result:

```text
toolResponse.functionResponses[{ id, name, response: { result } | { error } }]
```

## Schema

No database schema change. The Live setup schema is the four function declarations above.

## Platform behavior

Copy uses the WebView clipboard. Insert uses the existing Windows paste and Android field insert. A voice note is the existing account inbox write. A handoff is the existing Supabase send. Android confirmation is on the floating panel. Windows confirmation is on the Assistant page and, while a card is waiting, on the always-on-top button stack.

## Automated checks

`pnpm check` passed: lint, `tsc --noEmit`, 43 files, 285 tests.

`pnpm build` passed.

`cargo check` for the Tauri crate passed. The overlay pin grew a confirm-height flag. No Rust tests were added.

Covered: the four declaration names, no `replace_selection` and no `NON_BLOCKING`, id correlation, malformed arguments and unknown tools not calling services, copy without confirmation, insert cancel, voice-note failure text, handoff confirm using the resolved device id without changing the saved target, a second pending call rejected, and End dropping a pending insert. Dictation tests still pass.

Not run: a live Gemini tool call, clipboard paste on a device, or the Windows overlay height on a monitor.

## Manual test

1. Ask: `Create a voice note that says Assistant tool test.`
2. Confirm if prompted.
3. Pass if it appears in the existing Voice Notes inbox.
4. Ask: `Copy the words copied by assistant to my clipboard.`
5. Pass if pasting elsewhere yields that text. Copy should not ask for confirmation. The page should say it was copied.
6. Ask to insert harmless text in another app.
7. Pass only if a confirm card appears first and the paste happens after Confirm.
8. Cancel one proposed insert, note, or handoff.
9. Pass if nothing changes and Assistant is told the action was cancelled.

## Known limitations

- Live Gemini was not asked to call these tools, and insert, copy, and handoff were not exercised on a device.
- Windows insert success means the existing paste keystroke was sent. It does not prove the other app stored the text.
- Copy can fail when the WebView clipboard is unavailable, including a hidden window. That failure is returned to Gemini. It is not reported as success.
- Ending the session, or a reconnect, drops a waiting action without a tool result because the old socket is gone.
- A selection still cannot be replaced in the source app.
- The token lock assumption for client setup fields is unchanged and still unverified live.

## Next-phase boundary

Stop here. Do not add Search, screenshots, memory, cross-device Assistant context, or computer control beyond these four actions.
