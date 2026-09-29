# Assistant 09 — Screen-aware multi-turn conversation

Prompt: `prompts/assistant-prompts/09-assistant-screen-aware-conversation.md`

Branch: `assistant`

## Phase goal

Keep one intentionally captured screenshot usable across later Assistant questions. Do not capture again because the real screen changed, and do not send the same image again on every turn.

```text
attach screenshot
→ "Why is this error happening?"
→ "Which line should I change?"
→ "What does the warning below it mean?"
```

## Starting state that mattered

An explicit capture was already in the working tree: Windows window-or-screen capture, Android MediaProjection, an in-memory JPEG, a preview with Remove and Recapture, and one Live video frame plus a context note. That work had no phase report yet. Each typed question also sent the JPEG again. Dictation was unchanged. There is still no Assistant phase 08 report.

## What shipped

The attached screenshot stays the active image until the user presses Recapture, presses Remove, or ends Assistant. Start does not clear a screenshot captured before Start. End clears it, along with an attached selection. Nothing watches the screen, and nothing treats the words "look again" as a capture.

The current Live socket receives the JPEG once. A later typed or spoken question does not send it again. Replacing the image sends the new JPEG once. A new socket (Start after End, or a resume) sends the current image once, because that socket has not seen it. Context stays bounded by the existing sliding-window compression. This phase does not resend the image to fight that compression.

The context note tells Gemini the image is one still, that it remains the image for later questions, and that a request to look again means the user must recapture. Selection and screenshot can both be attached. The Assistant page labels them "Attached selection" and "Attached screenshot".

## Files

- `src/assistant/AssistantController.ts` — one frame per socket; later questions reuse it
- `src/assistant/snapshot.ts` — the still-image note, including look-again
- `src/assistant/AssistantPanel.tsx` — attached-screenshot label beside the selection
- `src/assistant/AssistantController.test.ts`, `snapshot.test.ts`
- `docs/ARCHITECTURE.md`

No token, database, dictation, or capture-pipeline change.

## Model, API, and config

Same `gemini-3.8-live` socket. The image is still one `realtimeInput.video` JPEG frame (`image/jpeg`), sent once per connection. Follow-up turns are ordinary `clientContent` or microphone audio. `contextWindowCompression.slidingWindow` is unchanged.

## Schema

None.

## Platform behavior

Windows and Android capture are unchanged. Recapture is still the only way to replace the image. The preview does not update on its own.

## Automated checks

`pnpm check` (lint, `tsc --noEmit`, vitest) passed: 45 files, 297 tests.

Covered:

- three later questions, including "look again", keep the same JPEG and do not send another frame
- an explicit second attach sends the new frame once, and the next question does not send it again
- a selection and a screenshot stay attached together
- End clears both
- the context note says to recapture rather than assume a new screen

## Manual test

Not run in this session.

1. Capture a screenshot with at least two distinct details.
2. Ask about detail 1.
3. Without recapturing, ask about detail 2.
4. Pass if Gemini still uses the attached image.
5. Change the actual screen and do not recapture.
6. Ask what it sees.
7. Pass if it still refers to the old attached image.
8. Recapture and ask again.
9. Pass if it uses the new image.

## Limitations

Pixels already sent cannot be removed from that Live session. Remove tells the model the image is no longer active. End is the clean break. If sliding-window compression drops older context, the image can age out. This phase does not recapture or resend to prevent that. Live Gemini was not tested.

## Next phase

Stop here. Memory, cross-device Assistant, and computer control are not started.
