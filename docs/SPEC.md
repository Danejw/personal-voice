# Product Specification

## Product goal

Build a personal cross-device voice application that begins as a high-quality system-wide dictation utility and can later grow into a broader real-time AI voice interface.

V1 must do one thing extremely well:

```text
Press → Speak → Release → Clean text appears at the cursor
```

## Initial platforms

- Windows
- Android

Future platforms may include macOS, iOS, and Linux, but V1 decisions should not be distorted to support them prematurely.

## V1 technology

```text
Tauri 2
React
TypeScript
Rust
Android Kotlin plugin where native Android services are required
Gemini 3.5 Transcribe Live
Supabase
GitHub Actions
```

Before wiring Gemini-specific API calls, verify the current Google documentation for the exact model name and Live API request schema.

## Primary interaction

### Windows

Default:

```text
Hold global hotkey
→ begin capture
→ speak
→ release hotkey
→ finalize transcript
→ insert text into focused application
```

The default hotkey can initially be something like Right Alt, but it must not be hard-coded into the architecture. Each Windows action can record several bindings. A binding is one key or mouse button, optionally with Ctrl, Shift, Alt, or Win, so the same action can use both a mouse button and a keyboard shortcut. Additional bindings may hold-to-talk into a voice note or a handoff.

### Android

Default:

```text
Press/hold floating microphone control
→ begin capture
→ speak
→ release
→ finalize transcript
→ insert into focused editable field
```

## Shared behavior

Both platforms should share:

- transcription behavior
- Gemini session handling
- transcript lifecycle
- dictionary
- settings
- authentication
- retry rules
- UI where practical
- application state

## Personal dictionary

Maintain a curated synchronized vocabulary.

Examples:

```text
Persyn
UFIQ
Lovable
Supabase
SeaDance
Runware
GenerationPlan
model_pricing_skus
```

Use the provider's current custom-vocabulary mechanism.

Do not dump thousands of arbitrary terms into the provider.

## Smart transcription

Use Gemini's native dictation/transcription cleanup capabilities first.

V1 should not run a second LLM over every transcript.

Desired behavior includes, where supported:

- punctuation
- capitalization
- disfluency removal
- repeated-word cleanup
- false-start cleanup
- lightweight formatting
- self-correction handling

The original meaning must remain intact.

## Backend responsibilities

The backend should remain tiny.

Use Supabase for:

- user authentication
- device records
- shared settings
- personal dictionary
- explicitly saved voice notes and sent device handoffs
- secure short-lived Gemini credential/token issuance

Do not send live microphone audio through Supabase.

## Data storage

Minimum useful schema:

### profiles

```text
id
created_at
```

### devices

```text
id
user_id
name
platform
last_seen
```

The current install can be renamed. Other installs can be removed. Notes and handoffs keep their device IDs after a row is deleted.

### dictionary

```text
id
user_id
term
enabled
created_at
updated_at
```

### settings

```text
user_id
smart_transcription
language
updated_at
```

### voice_notes

Explicitly saved when Voice note is the selected dictation destination:

```text
id
user_id
text
source_device_id
status
created_at
updated_at
```

### handoffs

Intentionally sent pasted text, typed text, or dictated transcripts:

```text
id
user_id
text
source_device_id
target_device_id (optional)
created_at
consumed_at (optional)
```

### Local recent dictation history

Keep at most 75 finalized dictations on the current device:

```text
text
timestamp
destination
success | failure
```

This is local recovery data, not a backend table.

### Local device preferences

Keyed by the existing per-account device ID, never written to `settings`:

```text
destination
microphone
showIndicator
pushToTalk
voiceNoteHotkey
handoffHotkey
```

Launch at login and Android overlay/accessibility/floating-mic state stay on the machine.

Keep schema additions conservative.

## Privacy defaults

- audio goes from the client to the transcription provider
- backend does not receive live audio
- audio is not permanently retained by the app
- voice notes sync only when the user explicitly chooses the Voice note destination
- handoffs sync only when the user explicitly sends text or chooses Send to device
- never monitor or continuously synchronize the OS clipboard
- selection capture is an explicit user action; Windows copies briefly and restores the clipboard
- usage analytics stores daily counters only, never transcript text, microphone audio, or raw key logs
- usage intelligence can be turned off; that preference syncs and stops new counts
- clearing analytics increments a server-owned epoch and deletes synced daily counters
- no automatic cloud transcript-history table
- recent dictation history contains final text only, stays local, and can be cleared
- do not log transcript content unnecessarily

## Reliability expectations

The app should handle:

- microphone unavailable
- provider connection failure
- connection drop during an utterance
- empty transcript
- duplicated final transcript events
- focus changes
- insertion failure
- quick press/release
- app restart
- expired short-lived credentials

The user should not lose dictated speech merely because a WebSocket fails at finalization.

A short-lived local utterance buffer may be retained until the utterance succeeds or is abandoned.

## Text insertion

### Windows

Start with the most broadly compatible approach:

```text
save clipboard
→ put transcript on clipboard
→ send paste command
→ restore previous clipboard
```

If clipboard restoration proves unreliable, prioritize correct insertion and data safety over cleverness.

Selection capture uses the same clipboard snapshot/restore path with Ctrl+C instead of Ctrl+V.
The previous clipboard is restored after the selected text is read.

Native Unicode input may be added later where useful.

### Android

Primary:

```text
AccessibilityService
```

Focused-field insertion remains the primary path. Selection capture reads only the
input-focused editable node's highlighted range. It does not scrape the screen.

Fallback where needed:

```text
clipboard + paste/user action
```

## UI

Keep the UI small.

Main settings view should contain only useful controls such as:

- status
- microphone
- push-to-talk shortcut
- Smart transcription toggle
- dictionary manager
- launch at startup
- floating control toggle
- account/sync status
- devices
- selection capture preview
- usage intelligence toggle

The always-visible floating control is the day-to-day interface: start dictation, choose a destination, capture a selection, and peek at recent voice notes and pending handoffs without opening Settings. While listening, the same control shows the listening state.

No dashboard.

## Explicitly out of scope for V1

The original dictation scope did not include an assistant. Assistant now exists as a second mode. It does not replace dictation. Its limits are in `docs/Assistant-Phases/`.

Still out of scope:

- meeting recording
- meeting summaries
- transcript analytics
- billing
- subscriptions
- teams
- multiple transcription providers
- offline ASR
- complex prompt pipelines
- public app-store distribution

## Future direction

The product has two voice modes:

```text
Voice Engine
├── Dictation Mode
│   └── dedicated speech-to-text model
└── Assistant Mode
    └── real-time multimodal voice model
```

Assistant Mode is implemented beside Dictation. Dictation stays Gemini 3.5 Transcribe Live. Assistant is Gemini 3.8 Live and reuses the capture, account, and platform boundaries. It does not share Dictation's session.

## V1 definition of done

Windows:

```text
hold hotkey
speak
release
text appears correctly in the focused app
```

Android:

```text
hold floating microphone
speak
release
text appears correctly in the focused field
```

Both:

- same user account
- same dictionary
- same core settings
- consistent transcription behavior
- no permanent Google API key in shipped binaries

Personal Voice work after V1 (destinations, notes, handoffs, history, devices, selection, usage) is reported in [`docs/PV-Phases/`](PV-Phases/README.md).
