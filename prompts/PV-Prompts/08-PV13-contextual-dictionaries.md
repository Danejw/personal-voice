# BUILD ORDER 08 — PV13: Contextual Dictionaries

The current dictionary is already synced and fed directly into Gemini 3.5 Transcribe. Extend it instead of replacing it.

## Goal
Implement **PV13 — Contextual Dictionaries**.

Allow dictionary terms to belong to simple groups such as:

```text
General
Persyn
UFIQ
Coding
```

Allow groups to be enabled/disabled. At transcription session creation, send only enabled terms from enabled groups to Gemini.

Preserve current active-term limits. Existing dictionary rows should migrate cleanly into a default `General` group.

Keep group management minimal: create, rename, enable/disable, and delete safely.

Do not create semantic search or AI-generated dictionaries.

Test the exact vocabulary sent to Gemini. Stop after PV13.
