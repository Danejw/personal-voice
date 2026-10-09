# PR25 — Context-Aware Tool Guidance and Progressive Loading

Builds on merged PR24 (result intelligence) and PR23 (on-demand tool playbooks) without replacing Gemini 3.8 Live.

## What changes

- `harness/contextAssembler.ts` produces two kinds of **trusted, bounded routing context**, using state already in the application:
  1. **Device capability note**: Windows vs Android, registered other-device count only if DeviceStore is synced, no invented online/presence claims. This is sent to the Live session once on a fresh connection, and updated only if facts change. It is available to **spoken and typed** interaction.
  2. **Task-scoped hint**: for clearly multi-step **typed** requests, a small deterministic hint identifies the most relevant of seven existing playbooks. Simple commands and normal conversation receive no task hint. The actual full playbook remains retrievable only via `get_tool_playbook`.
- `AssistantController` tracks the device capability note through reconnects. When the socket resumes with the same environment, it does not repeat the note; on a fresh socket or changed facts, it sends the current note. No background tasks or extra model requests.
- The session `sendTurn` API accepts an optional fifth routing-context argument; protocol places it in a **separate part before the actual user message**. Untrusted user words are never interpolated into generated hints.
- `App.tsx` supplies authoritative platform type and registered device count from the existing DeviceStore, not a guessed host or online state.
- Uses known attachment state for screenshots, selection and camera context, without creating captures or monitoring.
- Tests cover platform-specific behavior, succinct routing choices, privacy, duplicate note avoidance, typed turn wire structure, and unaffected simple commands.

## Why this design

Gemini Live has a fixed function declaration set at session setup. PR25 does **not** attempt dynamic mid-session registration or force an extra planning inference. Guidance is a small note for actual device capability, a brief optional typed-turn hint for complex requests, and a full playbook only when the model requests one. This preserves low latency for a normal dictation or one-tool voice request.

**Voice limitation:** audio input is processed directly by Live and its transcription often arrives only after the model begins reasoning. This PR supplies **device guidance to voice sessions**, while extra *task-specific deterministic routing hints* are applied only to typed turns. Spoken commands still have PR22 tool descriptions and PR23's optional on-demand playbooks. PR26 will measure real voice decision quality.

## Existing behavior preserved

- 54 declared tools, their parameters, executor, validators and run permissions
- Windows UIA, Computer Use, Android, camera, dictation, auto-run/review modes
- No extra provider/model call, migrations, scheduler, or telemetry logging
- No user text/screenshots/notes included in generated hints
- Result interpretation and outcome-verification guidance from PR24

## Tests

```bash
pnpm check
pnpm exec vitest run src/assistant/harness/contextAssembler.test.ts src/assistant/AssistantController.test.ts src/assistant/protocol.test.ts
```

## Manual smoke tests

1. **Windows, complex task:** In Assistant, type: `Open Notepad and then click the Save button.` Expect task-specific Windows workflow guidance, existing tool calls, and existing approval behavior. Do not interpret the tool hint itself as completion.
2. **Simple task:** Type: `Copy these words.` Expect direct clipboard tool usage, without any playbook lookup requirement.
3. **Conversation recall:** Type: `Find our earlier conversation about the app and continue it.` Expect list of previous threads followed by explicit continuation, not an unrelated memory lookup.
4. **Android:** With an Android Assistant voice session, ask about a desktop control. The assistant should not claim local Windows UIA or pointer control is available on the phone; a named remote device is a separate capability.
5. **Cross-device:** Ask to send a handoff to a named device and separately ask to insert remotely. Expect `send_handoff` versus `send_remote_dictation`, with offline status or uncertainty described accurately.

Run Windows and Android CI; do not merge until both pass and the above smoke tests are satisfactory.

## Next

PR26: observable evaluation of actual model tool choices, latency, avoidable lookups, and end-state results across typed and spoken scenarios.
