# BUILD ORDER 29 — PV26: Cross-Device Assistant Context

Build on Handoff, device identity, and Assistant Mode.

## Goal
Implement **PV26 — Cross-Device Assistant Context**.

Allow an Assistant task/conversation to be deliberately handed from one owned device to another.

Do not synchronize a raw live Gemini session.

Serialize only application-level context needed to continue:

```text
recent conversation turns
selected context references
task description
source device
timestamp
```

The receiving device starts a new valid Assistant session using that handoff context.

Keep transfer explicit. Do not automatically synchronize every conversation.

Bound the amount of conversation history transferred and make context ownership/deletion clear.

Stop after PV26.
