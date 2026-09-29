# PV7 implementation report — selection plus voice instruction

Prompt: `prompts/PV-Prompts/Done/11-PV7-selection-plus-voice-instruction.md`

## Scope

Build on PV6 capture. The user speaks an instruction, Gemini 3.5 Transcribe turns it into text, and a separate text action rewrites the captured selection. The rewrite is previewed. Replace, copy, and cancel are explicit. Dictation destinations and `DictationController` are unchanged. Assistant Mode is not started.

## Instruction

The Selection panel and the floating tray share one hold. Pressing it captures whatever is highlighted and starts Gemini 3.5 Transcribe; the transcript is the instruction for that capture. Releasing ends the instruction. The tray button does not bring Settings forward until the rewrite is ready to preview.

## Text action

`TextAction` (`src/text/TextAction.ts`) is the provider boundary. `geminiTextAction` posts `{ selection, instruction }` to the `text-action` Edge Function.

Ephemeral tokens are still Live-only, so this does not reuse `gemini-token`. The function verifies the user JWT the same way `gemini-token` does and calls `generateContent` with the server-side `GEMINI_API_KEY`.

Model: `gemini-3.5-flash-lite` (stable, lowest-cost current text model as of July 2026; thinking is off by default). Selection and instruction are each capped at 20,000 characters. The function returns only the rewritten text. It logs status codes, not the selection, the instruction, or the key.

## Replace

Replace uses the existing `insertReceivedText()` path after the user asks for it and the rewrite succeeded. Windows hides Settings and pastes over a highlight that is still active. Android moves Settings back and splices the focused selection. If that fails, the preview stays and Copy result still works. Cancel aborts an in-flight rewrite and drops the result. The captured selection stays.

## Deviations

- The working tree had dropped PV6 in `caf66b3`. This phase restored `a945ccb` and extended that capture UI. Capture itself was not rewritten.
- `text-action` is deployed to project `dlovrtlkniolcovfgvvj` (version 1, gateway `verify_jwt` off) with the same JWT check as `gemini-token`.

## Checks

| Check | Result |
| --- | --- |
| Selection reducer: failure and cancel never reach replace | PASS (unit) |
| Text-action response parsing, including empty model output | PASS (unit) |
| Live rewrite in Cursor, a browser, and Android | Not run in this session |
