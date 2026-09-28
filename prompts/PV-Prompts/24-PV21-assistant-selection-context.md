# BUILD ORDER 24 — PV21: Assistant + Selection Context

Build on Assistant Mode and PV6.

## Goal
Implement **PV21 — Assistant + Selection Context**.

Allow an intentionally captured selection to be attached to an Assistant conversation.

Example:

```text
select an error
→ open Assistant
→ "Why is this failing?"
```

The assistant receives the selection text, source app if known, and spoken question.

Do not automatically scrape surrounding content.

Clearly show when selection context is attached and allow removing it before sending.

Do not permanently add selected text to assistant memory.

Keep the generic `ContextItem` representation reusable.

Stop after PV21.
