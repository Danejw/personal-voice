# BUILD ORDER 11 — PV7: Selection + Voice Instruction

Build directly on PV6.

## Goal
Implement **PV7 — Selection + Voice Instruction**.

Workflow:

```text
select text
→ capture selection
→ speak an instruction
→ produce transformed text
```

Examples: `make this shorter`, `rewrite this clearly`, `turn this into bullets`, `explain this`.

Keep Gemini 3.5 Transcribe responsible for converting the spoken instruction to text. Do not modify the dictation pipeline.

For transformation, introduce a clean text-action boundary so the system is not permanently tied to one model/API. Use the simplest current Gemini text model available through the existing secure backend architecture.

Do not replace selected text automatically until the generated result succeeds.

Support preview result, replace selection where supported, copy result, and cancel.

Do not create Assistant Mode yet. Stop after PV7.
