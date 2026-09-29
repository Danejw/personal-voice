# PV10 implementation report — continuous dictation

Prompt: `prompts/PV-Prompts/Done/19-PV10-continuous-dictation.md`

Hands-free (PV9) shipped in the same change. Its prompt was already filed under `Done/`, but the app was still push-to-talk only: Gemini automatic speech detection was disabled.

## Scope

One listening session can insert several dictated sentences and stay ready for the next. This is still dictation. Nothing here replies, reasons, or calls another model.

Push-to-talk is unchanged. It still disables automatic detection and sends `activityStart` / `activityEnd`.

## Modes

- **Hands-free.** The mic and one automatic-detection session open, wait for speech, insert the first sentence through the current destination, then stop.
- **Continuous.** The same session stays open. Each sentence inserts, then the mic stays ready. The status reads **Continuous**, and distinguishes waiting from hearing. Stop ends the mode and inserts a sentence already in progress. Cancel utterance drops only the current sentence.

Push-to-talk presses are ignored while either mode is active. The destination can change while waiting, and is locked while a sentence is being heard, transcribed, or inserted. The overlay mic stays push-to-talk when idle. While an auto mode is running it shows Cont or Free and a click stops that mode.

## Session choice

One Gemini session covers a continuous run. A new session opens only after a dropped connection, Stop, or 9.5 minutes. Gemini's live transcription stream is documented at 10 minutes, so the early cutover stays under that cap. Mic audio during the cutover is buffered and flushed into the new session. A turn from the session that was just closed is ignored.

A dropped live session recovers the current sentence from the in-memory buffer, then continuous opens a fresh session. Hands-free does not restart.

## Limits

- 60 seconds with no speech while waiting closes the mic.
- 5 minutes ends the current sentence with `audioStreamEnd`. Continuous keeps listening on the same session.
- PCM is kept only for the current turn and dropped when that turn is delivered, cancelled, or fails.

## Deviations

- Hands-free and continuous shipped together because hands-free was not implemented.
- Continuous does not open a new Gemini session after every sentence. Reconnecting between sentences would drop the audio Gemini's detector needs. The 10-minute cap is what forces a fresh session.
