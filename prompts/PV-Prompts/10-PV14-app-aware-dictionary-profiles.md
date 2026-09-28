# BUILD ORDER 10 — PV14: App-Aware Dictionary Profiles

Build on PV13 and source-app information from PV6.

## Goal
Implement **PV14 — App-Aware Dictionary Profiles**.

Allow dictionary groups to activate automatically based on the foreground application.

Examples:

```text
Cursor → General + Coding + Persyn
Browser → General
UFIQ-related workflow → General + UFIQ
```

Keep manual overrides available.

Do not understand arbitrary screen content. Only identify the active application using the smallest OS-supported mechanism.

Keep platform-specific app detection behind `PlatformAdapter`.

If Android cannot expose equivalent app identity without problematic permissions, implement only the supported behavior and document the limitation.

App changes should affect the vocabulary used on the **next** dictation session, not the current one. Stop after PV14.
