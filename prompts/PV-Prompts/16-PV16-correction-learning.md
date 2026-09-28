# BUILD ORDER 16 — PV16: Correction Learning

Gemini 3.5 Transcribe already performs significant smart cleanup. Do NOT rebuild generic grammar correction.

## Goal
Implement **PV16 — Correction Learning** only for reliable personal corrections.

Focus on cases such as:

```text
person.ai → Persyn.ai
you fi q → UFIQ
```

Do not silently infer corrections merely because text changed later.

Implement an explicit or strongly observable correction flow, for example:

```text
recent dictation
→ Correct
→ user supplies corrected term/text
→ offer to add relevant term to dictionary
```

If a repeatable mapping system is useful, keep it narrow and transparent.

Do not add a general post-processing LLM layer over every Gemini transcript.

Gemini 3.5 SMART transcription remains the primary cleanup system. Stop after PV16.
