# Future V2 — Voice Assistant Mode

This file exists to protect the V1 architecture from shortsighted decisions.

Do not implement this during V1.

## Direction

The product should eventually become more than a dictation app.

Conceptually:

```text
Voice Input
↓
Mode
├── Dictation
│   └── speech → text → insert
└── Assistant
    └── speech → understand → act/respond
```

Future Assistant Mode may support:

- continuous/live AI conversation
- tool calling
- web search
- calendar actions
- email actions
- application control
- screen context
- workflows
- memory/personalization
- voice responses

## Architectural requirement now

V1 should avoid tightly coupling:

- microphone capture to Gemini Transcribe
- UI to one provider
- platform insertion to transcript generation
- authentication to one voice mode

That is enough future-proofing.

Do not build unused assistant abstractions beyond these clean boundaries.
