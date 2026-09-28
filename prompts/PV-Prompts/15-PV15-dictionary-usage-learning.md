# BUILD ORDER 15 — PV15: Dictionary Usage Learning

Build on grouped dictionaries and usage instrumentation.

## Goal
Implement **PV15 — Dictionary Usage Learning**.

Track whether enabled custom dictionary terms appear in finalized transcripts.

Maintain simple per-term statistics:

```text
times observed
last observed
```

Do not use another AI model to determine usage and do not assume Gemini's internal recognition reasoning is available. This is simple output matching only.

Expose useful labels such as `Used recently`, `Never observed`, and `Rarely used`.

Do not automatically delete terms. The user remains responsible for changes.

Stop after PV15.
