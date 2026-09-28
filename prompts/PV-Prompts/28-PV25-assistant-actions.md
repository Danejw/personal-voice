# BUILD ORDER 28 — PV25: Assistant Actions

Assistant Mode now understands voice, selected text, notes/handoffs, and screenshots.

## Goal
Implement **PV25 — Assistant Actions**.

Give the assistant a very small typed tool/action set using capabilities the application already has.

Initial tools may include:

```text
create_voice_note
create_handoff
copy_text
insert_text
open_recent_dictation
```

Do not expose arbitrary shell execution or general computer control.

Separate:

```text
assistant proposes tool call
→ application validates
→ action executes
→ result returns to assistant
```

Require confirmation for actions that modify or send user data unless the action is obviously reversible and low risk.

Tool schemas should be explicit and testable.

Reuse existing application services instead of duplicating business logic inside Assistant Mode.

Stop after PV25.
