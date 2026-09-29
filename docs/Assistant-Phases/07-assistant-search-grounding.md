# Assistant 07 — Google Search grounding

Prompt: `prompts/assistant-prompts/07-assistant-search-grounding.md`

Branch: `assistant`

## Phase goal

Let Assistant answer current public questions with Gemini 3.8 Live's own Google Search grounding. Keep ordinary answers ordinary. Show a source only when grounding actually returned one.

## Starting state that mattered

Assistant setup already declared the four safe function calls. Search was not enabled. A server message had no grounding parser, so citations could not be shown. Dictation still uses Gemini 3.5 Transcribe Live and was left unchanged. The token function was not modified and was not deployed.

## What shipped

Assistant setup now adds a second tool, `{ googleSearch: {} }`, beside the existing function declarations. That is the Live websocket shape from the tools guide checked on 2026-09-15, for model `gemini-3.8-live`. It is not the Interactions API `{"type":"google_search"}` tool, and it is not a second search backend.

Search is available for the whole Assistant session. It is not required on a turn. A system instruction tells the model to use Search for changing public information and not for ordinary conversation or arithmetic. Nothing in setup says to search every turn.

Citations come from `serverContent.groundingMetadata`, the Live server field documented on `ai.google.dev/api/live`. The app keeps web chunks with an `http` or `https` URI and a title (or the hostname when the title is missing). Duplicate URLs are dropped. At most eight sources are kept. The HTML search widget (`searchEntryPoint.renderedContent`), search-query strings, and non-web chunks are not shown and are not passed into the page as raw provider data.

A reply with no citations has no sources field and no "Sources" label. Sources that arrive while a reply is in progress sit on that reply, including after the turn is already on screen. A citation with no spoken text does not create a sourced turn.

Attached selection text now says not to put that text into a web search unless the user asks to look it up. The same rule is in the session instruction for voice notes and other private text. The selection is still sent as conversation context, because that is what the user attached. It is not copied into a separate search request.

## Files

- `src/assistant/grounding.ts` — Search guidance and citation parsing
- `src/assistant/protocol.ts` — `googleSearch` in Assistant setup, grounding events
- `src/assistant/AssistantSession.ts`, `AssistantController.ts`, `state.ts`, `AssistantPanel.tsx`
- `src/assistant/selectionContext.ts` — do not search an attached selection unless asked
- `src/app/app.css`
- `docs/ARCHITECTURE.md`

No token, database, or dictation change.

## Model, API, and config

Same `gemini-3.8-live` socket. Tools are client setup, like the function declarations: the assistant token lock does not list `googleSearch`. If Google treats `liveConnectConstraints.config` as a full replacement, Search would not apply until the token changes. That was not verified live.

Dictation does not receive this setup.

## Schema

No database schema change. The Live tool entry is `{ googleSearch: {} }`.

## Platform behavior

Sources render on the Assistant page as compact links, including while the reply text is still arriving. Windows and Android share that page. The floating controls do not list sources.

## Automated checks

`pnpm check` passed: lint, `tsc --noEmit`, 44 files, 288 tests.

`pnpm build` passed.

Covered: Search is on Assistant setup and is not forced, ordinary turns emit no grounding event, web citations are kept, unsafe and non-web chunks are dropped, the HTML widget is not forwarded, and a math-style reply is not marked sourced while a later grounded reply is. Dictation tests still pass.

Not run: a live Gemini search, or a check that a math question produced no source links on a device.

## Manual test

1. Ask: `What is 12 times 8?`
2. Pass if it answers normally and the reply has no source list.
3. Ask: `What is the latest stable Gemini Live model available right now? Search if needed.`
4. Pass if the answer is spoken and useful source links appear for that reply.
5. Ask a follow-up about one sourced fact.
6. Pass if the conversation stays coherent. The follow-up should not be labeled as sourced unless that reply has its own citations.

## Known limitations

- Live Gemini was not asked a current-information question, so Search actually running and the spoken answer staying in sync with the links were not verified.
- The model decides whether to search. A current question can still be answered from memory with no sources. That is not labeled as sourced.
- An attached selection remains in the Live conversation. The instruction says not to search it unless the user asks. The app cannot stop the model from ignoring that instruction.
- The token-lock assumption for client setup fields is unchanged and still unverified live.
- Source links are on the Assistant page only.

## Next-phase boundary

Stop here. Do not add screenshots, memory, cross-device Assistant context, or computer control beyond the four safe actions.
