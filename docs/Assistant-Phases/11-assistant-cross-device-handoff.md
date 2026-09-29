# Assistant 11 — Cross-device Assistant handoff

Prompt: `prompts/assistant-prompts/11-assistant-cross-device-handoff.md`

Branch: `assistant`

## Phase goal

Let the user deliberately continue an Assistant task on another owned Personal Voice device. Do not transfer a raw Gemini WebSocket session.

## Starting state that mattered

Handoffs already move plain text between devices on the same account through the `handoffs` table. Assistant already kept an in-memory conversation, a selection, up to eight notes, one attached handoff, and one screenshot. Ending a session drops the Live socket. A resumption handle stays on that device only. Dictation was unchanged.

## What shipped

Assistant has **Continue on another device**. That builds a version 1 package and sends it with the existing handoff send, to the device already chosen in Handoffs. If no device is chosen, the send is refused. The package is not broadcast to every device.

The text column carries the package behind the prefix `PV_ASSISTANT_CONTINUATION_V1`. Text that does not start with that prefix stays a normal handoff. Copy, Insert, and the Windows toast still paste that text. A continuation does not.

The package holds a title, the newest turns (at most 12, each at most 2,000 characters, 24,000 characters for the whole package), attached selection text, attached note text and ids, one attached handoff, screenshot metadata, the source device id and name, and a timestamp. It does not hold a token, microphone audio, a Gemini resumption handle, screenshot pixels, or the rest of the account. A newer version, broken JSON, an unknown field, or a package whose source device does not match the handoff row is refused.

On the other device the row is labeled **Assistant continuation**. **Continue** is required. It starts a new Assistant session, shows the carried turns, and sends them once as Live `clientContent` with `turnComplete: false`. Later questions are normal turns on that new socket. The page says which device it was continued from. A screenshot is described as not transferred. The user captures again if the new session needs the image.

**Continue** consumes the row after the new session has started, so it is not opened twice. If Assistant cannot start, the row stays. **Dismiss** consumes it without opening, the same as a text handoff. Signing out still ends Assistant.

## Files

- `src/assistant/continuation.ts` — version, bounds, classify, and ownership check
- `src/assistant/protocol.ts` — history seed with `turnComplete: false`
- `src/assistant/AssistantSession.ts`, `AssistantController.ts`, `state.ts` — new session, no reused handle
- `src/assistant/AssistantPanel.tsx`, `src/app/App.tsx` — send and open
- `src/handoffs/HandoffPanel.tsx`, `handoffAlert.ts`, `useHandoffAlerts.ts` — continuation versus plain text
- `src/overlay/overlay.ts`, `useOverlay.ts` — title in the overlay; copy and insert refuse a continuation
- Tests in `continuation.test.ts`, `AssistantController.test.ts`, `protocol.test.ts`, `HandoffStore.test.ts`, `overlay.test.ts`
- `docs/ARCHITECTURE.md`

## Model, API, and config

Unchanged. Gemini 3.8 Live. The token body is unchanged. The new session uses the same setup as any other Assistant start, including the Search-quota retry. No schema migration. The existing `text` column holds the versioned package.

## Platform behavior

Windows and Android share the handoff inbox. The overlay shows the continuation title, not the raw package. A toast click opens Handoffs instead of pasting. Copy and Insert stay available for plain text only.

## Tests

`pnpm check` passed: lint, tsc, and vitest (47 files, 305 tests). Coverage includes version 1 round-trip, turn and size bounds, a newer version, broken JSON, a forbidden field, source-device mismatch, target-device routing, another account not receiving the row, plain-text handoffs still classifying as text, and a new session seeded without a resumption handle. `pnpm build` passed. The existing chunk-size warning remains.

## Manual test

Not run.

1. On Device A tell Assistant: `The cross-device code word is pineapple seven.`
2. Choose Device B in Handoffs, then **Continue on another device**.
3. On Device B, open the continuation with **Continue**.
4. Ask: `What was the cross-device code word?`
5. Pass if the answer comes from the new session.
6. Send a normal plain-text handoff.
7. Pass if copy, insert, and dismiss still behave as before.

## Next phase boundary

Stop here. Do not start memory, remote device context, or computer control.
