# Phase 3 — Reliability

Read the project docs and inspect the completed Phase 2 implementation.

## Goal

Make Windows dictation resilient before adding backend/sync work.

## Implement

A temporary local utterance buffer that exists only while the utterance is unresolved.

Handle:

- Gemini connection failure
- connection drop mid-utterance
- microphone unavailable
- empty transcript
- duplicate final transcript
- quick hotkey press/release
- cancellation
- focus changes
- failed text insertion
- expired/invalid provider session

Where Google's current APIs provide a clean same-provider fallback transcription path, use the buffered utterance to recover after a Live failure.

Do not add another ASR vendor.

Do not permanently save microphone recordings.

## State

Review the session lifecycle and remove scattered lifecycle booleans where an explicit state transition is clearer.

## Tests

Add automated tests for:

- one final transcript inserts once
- duplicate provider finals are ignored
- cancellation never inserts
- error returns app to usable state
- next utterance is unaffected by previous failure
- retry cannot insert stale output

## Acceptance criteria

A failed utterance does not poison future dictation sessions.

The app always returns to a predictable usable state.

Stop after reliability work. Do not start Supabase yet.
