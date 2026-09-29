# Assistant 05 — Selection context

Prompt: `prompts/assistant-prompts/05-assistant-selection-context.md`

Branch: `assistant`

## Phase goal

Let an explicit selection capture become the source for one Assistant conversation:

```text
highlight text
→ capture selection
→ ask by voice or text
→ Assistant uses that exact text
→ Remove or End drops it
```

Assistant may suggest a rewrite. It does not change the other app.

## Starting state that mattered

Selection capture already produces a `ContextItem` (`type: "selection"`, text, optional source app, timestamp) from the Windows and Android adapters. The Selection page and the floating control can capture. Nothing was sent to Assistant. `DictationController` was left unchanged.

## What shipped

Capture from the Selection page or from quick access (overlay button or the selection shortcut) attaches that `ContextItem` to Assistant. Nothing captures on its own. Assistant does not read the screen, the surrounding app, or the clipboard except through the existing capture command the user already triggered.

The Assistant page shows a short preview, the source app when capture named one, and Remove. The Android floating panel shows the same preview and **Remove selection**. The Windows floating button's tooltip includes the preview. The full text stays in memory only, up to 8,000 characters. A longer selection is refused with a clear message and is not trimmed.

While it is attached:

- A typed instruction is one Live `clientContent` turn with two parts: the selection, then the instruction, `turnComplete: true`. The on-screen user line is only the instruction.
- A spoken session gets the selection as `clientContent` with `turnComplete: false` when it is attached and again after the socket is ready, including a reconnect. The spoken words stay the instruction.

Remove sends `turnComplete: false` text that the selection is no longer active context, then later turns omit it. End drops it and does not restore it on the next Start. A new session is therefore a fresh context. The text is not saved, not synced, and not added to analytics. The existing `selection_captured` counter still fires and does not include the text.

## Lifetime

Attached until Remove or End. Remove makes the next turn a fresh context without that selection. End makes the next Start a new Gemini session without it.

## Files

- `src/assistant/selectionContext.ts` — limit, preview, source text, detach text
- `src/assistant/protocol.ts` — selection part and context note
- `src/assistant/AssistantSession.ts`, `AssistantController.ts`, `state.ts`, `AssistantPanel.tsx`
- `src/context/SelectionPanel.tsx`, `src/app/App.tsx`
- `src/overlay/overlay.ts`, `useOverlay.ts`, `OverlayDock.tsx`
- `src-tauri/gen/android/.../OverlayPanelView.kt`
- `docs/ARCHITECTURE.md`

No token or schema change. No insert back into the source app.

## Model, API, and config

Same `gemini-3.8-live` socket as phase 04. Selection uses `clientContent` turns. `turnComplete: true` is the user's finished typed instruction. `turnComplete: false` adds or removes source context without asking for a reply by itself.

## Schema

None.

## Platform behavior

Windows and Android both use the existing `captureSelection` adapters. Quick access attaches the result. Android can remove it from the floating panel. Windows can remove it from the Assistant page. The floating tooltip shows that a selection is attached.

## Automated checks

`pnpm check` passed: lint, `tsc --noEmit`, 42 files, 276 tests.

`pnpm build` passed.

Covered: attach and remove, source app on the wire, the 8,000-character bound, Start with no selection, a later turn after remove omitting the text, End clearing it, two-part client content, and the detach note. Dictation tests still pass.

Not run: a live Gemini rewrite, or a check that the other app's text stayed unchanged on a device.

## Manual test

1. In another app, select: `Persyn are a application that help create content.`
2. Capture it from the Selection page, the floating control, or the selection shortcut.
3. Start Assistant if it is not already listening. Ask: `Rewrite the selected sentence so the grammar is correct.`
4. Pass if the reply uses that exact sentence and only proposes a correction. The other app's text should be unchanged.
5. Remove the selection.
6. Ask what the selected sentence was, or ask for another rewrite.
7. Pass if Assistant treats the selection as gone. End and Start also begin with no attachment.
8. Confirm the original app text was not edited.

## Known limitations

- Live Gemini was not asked to rewrite a selection, and the other app was not checked on a device.
- A selection already sent in an earlier turn can still be in that Live session's memory. Remove tells the session it is no longer active and stops sending it. End is the clean break, because the next Start is a new session.
- Capture still depends on the existing Windows clipboard path and Android accessibility selection. Pages that capture cannot read are unchanged.
- No tools, Search, screenshots, saved memory, or remote context.

## Next-phase boundary

Stop here. Do not add tools, Search, screenshots, remote context, or memory.
