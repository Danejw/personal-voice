# BUILD ORDER 27 — PV24: Screen-Aware Conversation

Build directly on PV23.

## Goal
Implement **PV24 — Screen-Aware Conversation**.

Allow an Assistant conversation to continue referring to intentionally supplied visual context across multiple turns.

Examples:

```text
"What is causing this error?"
"Okay, what should I change?"
"What does this warning below it mean?"
```

Keep clear control over context lifetime.

The UI should show which screenshot/window context is active.

Allow replace screen context, remove context, and capture again.

Do not continuously stream the desktop and do not silently recapture when the screen changes.

Keep token/context usage bounded.

Stop after PV24.
