# BUILD ORDER 19 — PV10: Continuous Dictation

Build on Hands-Free mode.

## Goal
Implement **PV10 — Continuous Dictation**.

Allow one listening session to produce multiple consecutive dictated utterances:

```text
speak sentence
→ transcript inserts
→ remain ready
→ speak another sentence
→ transcript inserts
```

This is still **dictation**, not Assistant Mode.

Do not maintain conversational reasoning or generate AI replies.

Reuse automatic speech detection and the destination system.

Provide an obvious continuous-mode indicator, stop, cancel current utterance, and timeout/safety limits.

Avoid keeping one Gemini session alive if one session per utterance is more reliable. Reliability is more important than theoretical connection reuse.

Stop after PV10.
