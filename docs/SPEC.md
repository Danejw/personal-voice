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

The default hotkey can initially be something like Right Alt, but it must not be hard-coded into the architecture. Each Windows action can record several bindings. A binding is one key or mouse button, optionally with Ctrl, Shift, Alt, or Win, so the same action can use both a mouse button and a keyboard shortcut. Additional bindings may hold-to-talk into a voice note or a handoff. Dictation also supports delayed mouse bindings: a quick click preserves the mouse button's normal behavior, while holding past the configured threshold (300/500/750/1000 ms, default 500 ms) starts the same Dictation pipeline and releasing finalizes it.

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

## Text transforms

Transforms are explicit post-transcription rewrites, not part of the speech recognizer. The default Dictation path remains one-pass Gemini 3.5 Transcribe Live. When the user selects a transform, the finalized transcript is sent through the existing authenticated `text-action` boundary before the chosen destination receives it.

Built-in profiles:
- Polish
- Prompt Engineer

Users may create account-synced custom profiles with a name and instruction. The same transform profiles are reusable from Dictation, Notes, Recent Dictations, Handoffs, and captured Selections. One-shot transforms preview the result before a destructive action; Notes can replace the original or save the transformed result as a new note.

The selected automatic Dictation transform is a per-device preference. `None` is the default. If a selected transform is unavailable or fails, the destination is not given untransformed text silently; the original finalized transcript remains available through the existing Dictation error/history path.

## Snippets

Snippets are deterministic whole-utterance text expansions. A user saves a short voice trigger such as `read only mode` or `my LinkedIn` and an exact expansion. After final transcription, Personal Voice normalizes case, repeated whitespace, and trailing sentence punctuation and checks for an enabled exact trigger match. Matching never uses fuzzy semantics or substring replacement in V1.

A matched snippet bypasses the automatic Dictation Transform so saved URLs, signatures, instructions, and other exact text are delivered unchanged. No additional model call is made for expansion. Server-confirmed snippets are cached locally so they can still expand while sync is offline, while creation/editing remains read-only until sync reconnects.

See [SNIPPETS.md](SNIPPETS.md) for matching rules and acceptance criteria.

## Backend responsibilities

The backend should remain tiny.

Use Supabase for:

- user authentication
- device records
- shared settings
- personal dictionary
- explicitly saved notes and sent device handoffs
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

### snippets

Account-synced exact voice expansions.

```text
id
user_id
trigger
normalized_trigger
content
enabled
created_at
updated_at
```

### transform_profiles

Custom reusable text transform instructions. Built-in profiles remain client-defined and immutable.

```text
id
user_id
name
instruction
created_at
updated_at
```


### notes

Explicitly saved account notes. Dictation, manual entry, and Assistant saves share the same note domain:

```text
id
user_id
text
source_device_id
source_type (voice | manual | assistant)
status
created_at
updated_at
```

The legacy `voice_notes` name remains a compatibility view while older installed clients roll forward.

Notes may also have an optional stable scan title and one reusable account-scoped Note group. Automatic organization runs only after an explicit Note is saved. It generates a title only while the title is missing, prefers an existing group, and creates a new group only for a clear cluster of at least three ungrouped notes. Manual title edits and manual group moves are authoritative and are not overwritten by later automatic passes. The Notes page is a responsive visual grid: group cards expose a small preview grid of their note titles before opening, while ungrouped Notes remain visible as standalone cards.

Notes may also have zero or more private file attachments. Attachments accept arbitrary file types, are stored in the private `note-attachments` Storage bucket, and keep only metadata in `note_attachments`. The current client accepts uploads up to 100 MB per file. In edit mode, files can be chosen, pasted from the clipboard when the clipboard exposes a file, or dropped onto the note. Images, video, and audio get inline previews; PDFs, Markdown, and other files remain downloadable/openable attachments. Assistant attachment of a Note still supplies the Note text only; file-content ingestion is a separate capability.

### handoffs

Intentionally sent pasted text, typed text, or continuation packages:

```text
id
user_id
text
source_device_id
target_device_id (optional)
created_at
consumed_at (optional)
```

Handoffs stay in an inbox until Insert / Copy / Dismiss. They are not automatic cursor insertion.

### remote_dictation_requests

Short-lived exact-transcript delivery from one owned device to another's active cursor:

```text
id
user_id
source_device_id
target_device_id
text
status (pending | processing | inserted | failed)
created_at
expires_at
completed_at
error
```

Requests expire in about six seconds. Successful rows are deleted after the sender observes completion. Audio is never sent device-to-device.

### Recent dictation history

Keep at most 75 finalized dictations on the current device:

```text
text
timestamp
destination
success | failure
```

This stays on the device until the user turns on Sync recent dictations. That account setting
is off by default. When it is on, the same final text is stored in `dictations` and can be
opened on the user's other devices. No audio is stored.

### Local device preferences

Keyed by the existing per-account device ID, never written to `settings`:

```text
destination
transformProfileId (optional selected automatic Dictation transform)
microphone
showIndicator
pushToTalk
voiceNoteHotkey
remoteDictationHotkey (legacy handoffHotkey still read)
remoteDictation (Allow remote dictation; default ON)
remoteDictationTargetDeviceId
```

Launch at login and Android overlay/accessibility/floating-mic state stay on the machine.

Keep schema additions conservative.

## Privacy defaults

- audio goes from the client to the transcription provider
- backend does not receive live audio
- audio is not permanently retained by the app
- voice-created notes sync only when the user explicitly chooses the Voice note destination; manually created notes sync when the user saves them
- handoffs sync only when the user explicitly sends text to the Handoffs inbox
- Remote Dictation sends only a finalized transcript to one selected device and expires quickly
- never monitor or continuously synchronize the OS clipboard
- selection capture is an explicit user action; Windows copies briefly and restores the clipboard
- snippet triggers and expansion text sync only because the user explicitly saves them; expansion itself is local and makes no extra model call
- usage analytics stores daily counters only, never transcript text, microphone audio, or raw key logs
- usage intelligence can be turned off; that preference syncs and stops new counts
- clearing analytics increments a server-owned epoch and deletes synced daily counters
- recent dictation history contains final text only and stays on the device until the user opts in
- cloud dictation history is off by default; the choice is saved on the account
- when it is on, final text is stored in `dictations` for the user's other devices
- turning it off stops new uploads
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

## Live dictation feedback

While the Active field destination is recording, Gemini's `partialTranscript` hypotheses
are shown progressively in supported focused text fields. Native implementations remember
and verify only their own temporary edit. A later hypothesis replaces that temporary
text; on finalization the corrected final transcript replaces it once, not a second paste.
Cancelling removes the temporary text if the field still matches. If a field cannot
provide a safe provisional edit, the regular finalized insertion is used instead.

Windows uses UI Automation's editable Value pattern for **initially empty** ordinary
text fields only. It verifies focused element identity, unchanged provisional value,
and non-password/read-write status before every edit. Existing content, rich editors,
and fields without this pattern keep the final-only path. No simulated backspaces or
clipboard edits are used for preview. Android uses Accessibility `ACTION_SET_TEXT`
only on an unchanged native editable or a recognized plain HTML text field, tracking the
focused node and original range. Neither platform ever previews into a password field.

Only `active-field` gets provisional text. Notes and Remote Dictation keep their
final-only save/delivery behavior. No interim hypotheses are saved to history, synced
to Supabase, or sent to other devices.

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

The original dictation scope did not include an assistant. Assistant now exists as a second mode. It does not replace dictation. Its limits are in `docs/Assistant-Phases/`. Saved Assistant conversation text is account data (`docs/Shared-Assistant-Phases/06.md`). The Assistant screen saves and reopens that transcript on every signed-in device. One device at a time holds the conversation and can answer. Starting Assistant on a saved thread sends that thread once as earlier context. A resumed connection does not send it again. Old actions are not run again. Explicit memories are separate from that transcript and from the analytics profile. A new session hears the active ones. Forgetting a memory does not delete the conversation. Learning new memories from saved Assistant messages is off until the account turns it on (`docs/Shared-Assistant-Phases/07.md`). Voice notes and dictations are not read for that.

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

### Camera Context

Assistant may use the device camera when the user explicitly asks (spoken, typed, tool, or UI). Capabilities:

- one still photo (`capture_camera_photo`) from default / front / back
- temporary live Camera Context (`start_camera_context` / `stop_camera_context`) at ≤ 1 JPEG frame per second over the existing Gemini Live session
- Windows webcams and Android front/rear cameras behind `PlatformAdapter.createCamera()`

Camera frames are ephemeral. They are not uploaded to Supabase, not stored in Assistant messages, not written to disk by Personal Voice, and not used for memory learning. Seeing something on camera is not authorization to click, type, or change the device. Reports: [`docs/Camera-Context-Phases/`](Camera-Context-Phases/README.md).

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
