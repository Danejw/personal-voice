# BUILD ORDER 05 — PV5: Recent Dictation History

## Goal
Implement **PV5 — Recent Dictation History**.

Keep a small local history of finalized dictations so I can recover something I recently said. This should be **local-first**.

Do not create a cloud transcript warehouse and do not save microphone audio.

Store only final text and minimal metadata:

```text
text
timestamp
destination
success/failure
```

Use a bounded retention policy such as the most recent 50–100 entries.

Provide a minimal UI to see recent transcripts, copy one, insert one, optionally resend through an existing destination, and clear history.

Normal dictation should never wait for history persistence. Add tests for retention limits and clearing. Stop after PV5.
