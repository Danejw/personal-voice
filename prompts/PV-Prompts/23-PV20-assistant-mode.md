# BUILD ORDER 23 — PV20: Assistant Mode

Now introduce the second major voice behavior.

Existing dictation must remain untouched:

```text
Gemini 3.5 Transcribe
→ transcript
→ destination
```

## Goal
Implement **PV20 — Assistant Mode**.

Before coding, research Google's current official Gemini Live multimodal/voice APIs and select the appropriate current conversational Live model. Do not assume an old model ID.

Architect this explicitly as:

```text
Voice
├─ Dictation Mode
│  └─ Gemini 3.5 Transcribe
└─ Assistant Mode
   └─ current Gemini Live conversational model
```

Reuse microphone infrastructure where sensible. Do not force Assistant concepts into `DictationController`.

Create a separate assistant session/controller with a clear lifecycle.

Initial Assistant Mode only needs start, listen, spoken/text response, multi-turn conversation, interruption, cancel, and end session.

Do not add tools or screen context yet.

Keep authentication through the secure short-lived credential architecture.

Stop after PV20.
