# BUILD ORDER 17 — PV8: Voice Commands

Use the destination, Notes, Handoff, History, and selection systems already implemented.

## Goal
Implement **PV8 — Voice Commands**.

Create a small explicit command mode separate from normal dictation.

Initial commands can include:

```text
save that as a note
send that to desktop
copy that
insert last dictation
archive this note
```

Prefer deterministic command parsing for this first version. Do not send every utterance through an AI agent.

Provide clear feedback when a phrase is treated as a command.

Normal dictation must never unexpectedly execute actions. Require an explicit command trigger/mode.

Keep the command registry small and typed. Stop after PV8.
