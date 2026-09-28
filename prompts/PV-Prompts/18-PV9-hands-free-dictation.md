# BUILD ORDER 18 — PV9: Hands-Free Dictation

The current push-to-talk path must remain intact.

## Goal
Implement **PV9 — Hands-Free Dictation** as an additional mode.

Before coding, verify the current official Gemini 3.5 Transcribe Live activity-detection/VAD capabilities.

The existing app manually sends activity start/end. For Hands-Free mode, use Gemini's supported automatic activity detection if it is reliable and available.

Conceptually:

```text
start hands-free
→ wait for speech
→ detect speech
→ detect end
→ finalize
→ destination
```

Do not build a second transcription pipeline.

Reuse current audio capture, Gemini provider, destination layer, recovery, and explicit state model.

Push-to-talk remains available. Add clear start/stop/cancel controls and sane session limits.

Test long pauses, background noise, no speech, cancellation, and consecutive utterances.

Stop after PV9.
