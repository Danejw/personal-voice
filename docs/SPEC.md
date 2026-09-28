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

The default hotkey can initially be something like Right Alt, but it must not be hard-coded into the architecture.

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

Keep schema additions conservative.

## Privacy defaults

- audio goes from the client to the transcription provider
- backend does not receive live audio
- audio is not permanently retained by the app
- transcript history is local-only if added later
- no cloud transcript-history table in V1
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

Native Unicode input may be added later where useful.

### Android

Primary:

```text
AccessibilityService
```

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
- listening indicator toggle
- account/sync status

During dictation, show a minimal listening indicator.

No dashboard.

## Explicitly out of scope for V1

Do not build:

- meeting recording
- meeting summaries
- AI assistant mode
- tool calling
- computer control
- screen understanding
- AI chat
- transcript analytics
- billing
- subscriptions
- teams
- multiple transcription providers
- offline ASR
- complex prompt pipelines
- public app-store distribution

## Future direction

The product should eventually support distinct voice modes:

```text
Voice Engine
├── Dictation Mode
│   └── dedicated speech-to-text model
└── Assistant Mode
    └── real-time multimodal voice model
```

The V1 capture, UI shell, auth, platform integration, device handling, and streaming infrastructure should be reusable by Assistant Mode later.

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
