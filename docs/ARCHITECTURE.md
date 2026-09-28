# Architecture

## Principle

One product, one repository, one shared application architecture.

Do not build independent Windows and Android applications that duplicate business logic.

## High-level flow

```text
                    ┌────────────────────┐
                    │ Gemini Live / ASR  │
                    └─────────┬──────────┘
                              │
                        direct connection
                              │
             ┌────────────────┴────────────────┐
             │                                 │
       Windows client                    Android client
             │                                 │
             └──────────────┬──────────────────┘
                            │
                     Shared application
                            │
              ┌─────────────┴─────────────┐
              │                           │
         voice/session                platform adapter
         transcript state                 │
         vocabulary                       ├─ Windows Rust
         settings                         └─ Android Kotlin plugin
         auth/sync
```

## Client stack

```text
Tauri 2
├── React + TypeScript
├── Rust core
└── native platform extensions only where required
```

## Shared layers

Recommended conceptual organization:

```text
src/
├── app/
├── components/
├── voice/
│   ├── provider/
│   ├── session/
│   ├── audio/
│   ├── transcript/
│   └── vocabulary/
├── auth/
├── settings/
├── sync/
└── platform/
```

Rust:

```text
src-tauri/src/
├── lib.rs
├── commands/
├── platform/
└── voice/
```

Android-native extension:

```text
src-tauri/plugins/voice-platform/android/
```

Exact paths may change if Tauri's generated structure requires it.

As implemented (Phase 6): the plugin is **inlined in the app** rather than a separate crate. Kotlin lives in `src-tauri/gen/android/app/src/main/java/com/personal/voiceapp/platform/`, Rust registers it in `src-tauri/src/platform/android.rs`, and `src-tauri/build.rs` declares its command permissions. See `docs/ANDROID.md`.

## Voice provider boundary

Gemini must not leak throughout the application.

Conceptually:

```text
VoiceProvider
  createSession(config)
      ↓
TranscriptionSession
  connect()
  startUtterance()
  sendAudio()
  endUtterance()
  close()
```

Provider events should normalize into application events such as:

```text
connected
partialTranscript
finalTranscript
error
closed
```

This makes it possible to improve or replace the provider later without rebuilding the platform integration.

## Platform boundary

Platform-specific functionality belongs behind a small adapter.

Responsibilities may include:

```text
registerPushToTalk
startCapture
stopCapture
insertText
showListeningIndicator
hideListeningIndicator
startAtLogin
openPlatformPermissions
```

Windows implementation should live in Rust/Tauri-native code.

Android native services should live in the Kotlin plugin.

Shared UI should call the adapter, not the operating system directly.

As implemented (Phase 2, `src/platform/PlatformAdapter.ts`): `insertText`, `showIndicator(state)`, `hideIndicator`, `setPushToTalkShortcut`, `setDictationActive` (routes Escape to cancel), `onPushToTalk` (press/release/cancel) and `onPausedChange`. Phase 6 added `createCapture()`: both platforms produce the same 16 kHz PCM16 chunks for the shared `DictationController`, via Web Audio (`BrowserAudioCapture`) on Windows and native `AudioRecord` (`NativeAudioCapture` → Kotlin `NativeMicCapture`) on Android, because the Android WebView cannot open the microphone while the app is hidden behind the floating mic. The adapter is chosen once in `src/platform/index.ts`. The Rust side is `src-tauri/src/commands` (IPC) plus `src-tauri/src/platform/<os>`.

## Application state

Use an explicit lifecycle.

Suggested states:

```text
IDLE
CONNECTING
LISTENING
FINALIZING
INSERTING
ERROR
```

Representative flow:

```text
IDLE
  ↓ hotkey/button pressed
CONNECTING
  ↓ ready
LISTENING
  ↓ released
FINALIZING
  ↓ final transcript
INSERTING
  ↓ success
IDLE
```

Failures route to `ERROR`, then recover to `IDLE` or reconnect.

## Audio flow

```text
microphone
↓
client capture
↓
temporary utterance buffer
↓
provider audio format conversion if required
↓
direct Live API stream
```

Do not put an additional backend hop in this path.

## Security flow

```text
client
↓ authenticated request
Supabase token function
↓ server-side Google credential
Google short-lived client credential
↓
client
↓
Gemini Live API
```

If Google's current ephemeral-token flow changes, update only the token-provider/backend layer.

As implemented (Phase 4, details in `docs/PHASE_4_REPORT.md`):

- Supabase email/password sign-in lives in the Settings window (`src/auth/`). The Supabase client is created lazily, so the indicator window never runs a second session-refresh loop.
- `src/services/geminiTokenService.ts` calls the `gemini-token` Edge Function with the user's access token. `GeminiTokenSource` keeps at most one unused token in memory and hands it out only inside its new-session window.
- `GeminiProvider` connects to `BidiGenerateContentConstrained` (v1alpha) with `access_token=`. There is no API key anywhere in the client.

## Sync flow

```text
dictionary/settings mutation
↓
local state updates immediately
↓
Supabase sync
↓
other device receives latest state on refresh/start
```

Real-time database subscriptions are optional, not required for V1.

Simple fetch-on-start plus save-on-change is acceptable.

As implemented (Phase 5, details in `docs/PHASE_5_REPORT.md`):

- `src/sync/PersonalSyncStore.ts` follows the signed-in account. It shows the cached copy at once, then loads from Supabase. Edits appear immediately and are written in order. A failed write rolls the view back to the last server-confirmed copy (keeping edits still in flight) and shows an error. Dictation never waits on sync.
- The cache (`localStorage`, one entry per account) holds only server-confirmed data. When Supabase is unreachable, the cached copy is shown read-only with a Retry button. There is no offline write queue.
- Supabase calls live in `src/services/personalSyncService.ts`, typed by `src/types/database.ts`. RLS limits every row to its owner.
- `App` builds each session's provider config at press time from `transcriptionPreferences()`. That config is provider-neutral (`TranscriptionPreferences` in `VoiceProvider.ts`), and `geminiConfigFrom()` maps it to Gemini's `mode`, `languageCodes`, and `customVocabulary`.
- Synced: Smart transcription and language. Local only: the push-to-talk shortcut.

## Failure recovery

Maintain the current utterance locally until:

- final transcript is received and inserted, or
- the user cancels, or
- recovery definitively fails

Recovery may use the same Google provider through a non-live transcription path if current APIs support it cleanly.

Do not add a second speech vendor solely for fallback.

As implemented (Phase 3, `src/voice/session/DictationController.ts`):

- Each press-to-release is one `Utterance` object. It owns the capture, the live session, and an in-memory PCM buffer. The object is dropped when the utterance is inserted, cancelled, or fails, so the buffer never outlives it and is never written to disk. Every async continuation checks that its `Utterance` is still current, so a stale final or recovery result cannot be inserted.
- The live path is a small tagged state per utterance (`connecting`, `streaming`, `ending`, `lost`) instead of lifecycle booleans. The visible lifecycle is still the `voiceReducer` states.
- Provider errors carry `retryable`. A retryable loss of the live session (network drop, connect or final-transcript timeout, `goAway`) keeps recording if the user is still speaking. On release the buffered audio goes to `VoiceProvider.transcribeRecording`. For Gemini that replays the buffer into a fresh Live session with a new ephemeral token, throttled by the socket's send buffer. Phase 3 first used a unary `generateContent` call, but ephemeral tokens are Live-only, so Phase 4 replaced it. The controller's recovery timeout is 30 s plus the utterance's length. A non-retryable error (signed out, not allowed, refused config) goes straight to ERROR.
- Release while still connecting finalizes immediately. The controller waits up to 2 s for the live session, then recovers from the buffer. Recordings under 250 ms are discarded as accidental taps. Recording auto-stops at 5 minutes.

## Future Assistant Mode

Keep capture separate from behavior:

```text
VoiceInput
↓
Mode Router
├── Dictation Mode
└── Assistant Mode
```

Assistant Mode may later introduce:

- real-time multimodal voice
- tool calling
- screen context
- application actions
- connected services

Do not add those abstractions beyond what is necessary in V1.
