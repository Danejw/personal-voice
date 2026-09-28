# BUILD ORDER 30 — PV30: Personal Context Layer

This is the final integration phase, not a reason to rebuild earlier systems.

The app now has dictation, destinations, notes, handoffs, history, device management, contextual dictionaries, selections, usage intelligence, Assistant Mode, screen context, Assistant tools, and cross-device assistant handoff.

## Goal
Implement **PV30 — Personal Context Layer**.

Create one controlled application-level interface for Assistant Mode to request useful personal context.

Potential sources:

```text
active dictionary groups
selected Voice Notes
selected Handoffs
recent dictation when explicitly allowed
device identity
current app
selection
screen snapshot
lightweight usage preferences
```

Do NOT create a giant permanent prompt containing everything and do NOT automatically expose all personal data to every Assistant session.

Design around explicit context scopes:

```text
ContextProvider
→ available context sources
→ user/session chooses relevant items
→ bounded context package
→ Assistant
```

Keep source data in its existing systems. The Context Layer should reference/assemble those sources rather than duplicating them into another database.

Do not add embeddings/vector storage unless a concrete retrieval requirement proves simple structured retrieval insufficient.

## Final audit
Audit the entire application for duplicate pipelines, duplicated storage, obsolete abstractions, unnecessary permissions, privacy leaks, platform-specific code escaping platform boundaries, Assistant code affecting dictation reliability, and confirmation that Gemini 3.5 Transcribe remains the dedicated dictation engine.

Run the complete test/build suite. Document technical debt and architecture drift.

Stop after PV30.
