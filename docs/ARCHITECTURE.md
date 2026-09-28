# Architecture

Personal Voice (PV) implementation reports, including what is done vs skipped, live in [`docs/PV-Phases/`](PV-Phases/README.md). V1 reports remain `docs/PHASE_*_REPORT.md`.

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

## Transcript destination boundary

A finalized transcript is delivered through `TranscriptDestination`, independently of the
provider and recovery path:

```text
VoiceProvider
↓ final transcript
DictationController
↓
TranscriptDestinationRouter
├─ active-field → PlatformAdapter.insertText()
├─ voice-note → VoiceNotesStore → Supabase
└─ send-to-device → HandoffStore → Supabase
```

PV2 introduced the boundary with `active-field` as its only destination. PV1 adds `voice-note`,
which saves the finalized transcript as an inbox note only after Supabase confirms the insert.
PV3 adds `send-to-device`; the selected owned device, or all other devices when no target is
selected, receives the text through the `handoffs` table. `HandoffStore` refreshes when Settings
regains focus or visibility rather than adding sockets or polling.
PV4 reuses that same store and table for explicitly pasted or typed text. The shared
`DeviceTargetField` keeps the Voice handoff and Shared clipboard entry points on one target
selection without reading or monitoring either operating system's clipboard.
PV5 observes each router result after the selected destination resolves or rejects. The observer
schedules a local `DictationHistoryStore` write without awaiting it, so history persistence
cannot delay or change dictation delivery.
`DictationController` depends only on the destination interface. A destination failure follows
the existing `ERROR` transition and leaves the transcript visible. Future destinations can be
added to the router without changing capture, Gemini, or recovery.

Reports: [PV2](PV-Phases/01-PV2-dictation-destinations.md), [PV1](PV-Phases/02-PV1-voice-notes-inbox.md), [PV3](PV-Phases/03-PV3-cross-device-handoff.md), [PV4](PV-Phases/04-PV4-shared-clipboard-send-to-device.md), [PV5](PV-Phases/05-PV5-recent-dictation-history.md).

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

As implemented (Phase 2, `src/platform/PlatformAdapter.ts`): `insertText`, `setHotkeys`, `setDictationActive` (routes Escape to cancel), `onPushToTalk` (press/release/cancel, with an optional destination on press) and `onPausedChange`. Phase 6 added `createCapture()`: both platforms produce the same 16 kHz PCM16 chunks for the shared `DictationController`, via Web Audio (`BrowserAudioCapture`) on Windows and native `AudioRecord` (`NativeAudioCapture` → Kotlin `NativeMicCapture`) on Android, because the Android WebView cannot open the microphone while the app is hidden behind the floating mic. The adapter is chosen once in `src/platform/index.ts`. The Rust side is `src-tauri/src/commands` (IPC) plus `src-tauri/src/platform/<os>`.

The floating Personal Voice control stays on top of other apps while idle. `syncOverlay(snapshot)` pushes dictation state, destination, recent notes, and pending handoffs to that control; `onOverlayAction` routes its clicks back into the shared stores. Listening is the same control changing colour/label, not a separate temporary indicator. `openSettings()` brings the Settings window forward when a less common action is needed. `captureSelection({ restoreSettings: false })` keeps Settings hidden so overlay capture does not steal the previous app.

PV3 adds `insertReceivedText()`. Windows hides Settings and lets the previous app regain focus
before invoking the existing native paste path. Android moves the Settings task behind the
previous app before invoking the existing accessibility insertion path.

PV6 adds `captureSelection()`, which returns a shared `ContextItem` (`type: "selection"`).
Windows hides Settings, snapshots the clipboard, sends Ctrl+C, reads Unicode text, then
restores the previous clipboard. A clipboard sequence that does not change is treated as no
selection. Android moves Settings behind the previous app, reads only the focused editable
node's selection range, then brings Settings back. Password fields, hint text, collapsed
cursors, and non-editable screens are refused; there is no screen scraping. The Settings
Selection panel previews the last capture and can copy or clear it. Captures live in memory
only. Report: [PV6](PV-Phases/09-PV6-selection-capture.md).

Phase 8 added `checkForUpdate()`, which returns an `AvailableUpdate` (`version`, `notes`, `action`, `install()`) or `null`:

- **Windows** (`action: "restart"`): `tauri-plugin-updater`, registered only on desktop. It reads `latest.json` from the latest GitHub release, verifies the installer against the minisign public key in `tauri.conf.json` (`requireSignedVersion`, so an old signed installer can't be announced as a newer version), and runs the NSIS installer in passive mode. The installer closes the app and reopens it.
- **Android** (`action: "download"`): Tauri's updater is desktop-only. `releaseService` reads GitHub's latest-release API, `parseAndroidRelease` accepts only `PersonalVoice-<tag version>.apk` from this repo's release downloads, and `install()` calls the Kotlin `open_download` command, which only opens `https://github.com/...` links in the browser. Android's package installer does the rest, and it refuses an APK signed with another key.

Phase 9: `createPlatformAdapter()` returns `AppPlatform`, the union of the two concrete adapters. Platform-only settings panels narrow on `platform.platform` (one switch in `App.tsx`), so launch at startup (`getLaunchAtLogin`/`setLaunchAtLogin`) exists only on `WindowsPlatformAdapter`, with no Android stubs. Per-device settings that aren't synced (microphone, floating-control visibility) live in `src/settings/deviceSettings.ts`, next to the push-to-talk shortcut.

The shared `src/updates/` holds the version comparison, the release parsing, and the `updateReducer` state machine (`idle → checking → available/upToDate → installing → handedOff | error`). The startup check fails quietly offline; a check the user asks for reports errors. `UpdatePanel` disables install while dictation isn't idle, because installing on Windows closes the app.

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

- Supabase email/password sign-in lives in the Settings window (`src/auth/`). The Supabase client is created lazily, so the overlay window never runs a second session-refresh loop.
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
- Synced: Smart transcription, language, and usage intelligence. Device-scoped (local, keyed by the existing device ID): default dictation destination, Windows microphone, floating-control visibility, and Windows push-to-talk. Local machine only: launch at login and Android overlay/accessibility/floating-mic runtime.
- Phase 9: the sync status (with Retry) moved to the Account section, and the edit panels say why they're read-only. While offline, the store reloads on its own when the browser reports `online` or the window becomes visible again. There is still no polling.
- PV1 adds `voice_notes` and a separate `VoiceNotesStore`. Notes load on sign-in and refresh when the app becomes visible, so changes made on another device appear without realtime infrastructure. Notes are created only when the user selects the Voice note destination; this is not automatic transcript history.
- PV3 adds `handoffs` and `HandoffStore`. Pending rows are filtered by owner, target, source device, and `consumed_at`; dismissing marks a row consumed. The source device never receives its own broadcast. Handoffs refresh on focus/visibility and use neither direct device networking nor realtime subscriptions.
- PV4 labels manual text entry as Shared clipboard while keeping Voice handoff as a dictation destination. Reloads replace the received snapshot, so they cannot duplicate rows; two explicit sends remain two distinct handoffs even when their text matches.
- PV12 adds a Devices panel on the existing `devices` table: friendly name, platform, last seen, and a This device marker. Rename writes only `name`; `touchDevice` still refreshes `last_seen` without overwriting a custom name. Remove is refused for the current device. Notes and handoffs have no foreign keys to `devices`, so deleting an old install does not delete their rows.
- PV11 stores device preferences in local WebView storage under `device.prefs.<device id>`, not in the account `settings` row. The first bind copies any previous unscoped `settings.*` keys into that record so existing installs keep their microphone, indicator, and hotkey. Windows and Android never share that file, so a Windows hotkey cannot land on a phone. Reports: [PV12](PV-Phases/06-PV12-better-device-management.md), [PV11](PV-Phases/07-PV11-device-specific-preferences.md).

## Usage intelligence

PV17 records structured operational counters on this device so I can see how the app is used. It is not a third-party analytics product and it never stores transcript text or microphone audio.

Events (each also carries `platform` from the local adapter):

| Event | When | Extra fields |
| --- | --- | --- |
| `dictation_started` | A new utterance begins | |
| `dictation_completed` | Destination delivery succeeded | `durationMs` (press → delivered) |
| `dictation_failed` | The utterance ended in ERROR | |
| `recovery_used` | Replay-from-buffer produced the delivered transcript | |
| `destination_used` | The selected destination accepted the transcript | `destination` |
| `voice_note_created` | A voice note row was saved | |
| `handoff_created` | A handoff row was saved | |
| `selection_captured` | Highlighted text was captured | |

Counters fold into local aggregates (`usage.totals.v1`). They are not synced: last-write-wins on `settings` would drop counts from the other device. The only synced field is `usageIntelligence` (default on). Turning it off stops collection; existing totals remain. A telemetry failure never changes dictation, notes, handoffs, or capture. Report: [PV17](PV-Phases/12-PV17-lightweight-usage-intelligence.md).

## Preference scope

| Setting | Scope | Why |
| --- | --- | --- |
| Smart transcription | Account | Same cleanup on every device |
| Language | Account | Same recognition language on every device |
| Personal dictionary | Account | Same vocabulary on every device |
| Device display name | Account device row | Shown in Devices and handoff targets |
| Default dictation destination | Device | Phone and PC often send transcripts to different places |
| Preferred microphone | Device | Hardware IDs are meaningless on another machine |
| Floating control | Device | Windows overlay; unused on Android (the floating mic is the control) |
| Push-to-talk shortcut | Device | Windows-only; each action can record several keys or mouse buttons; Android uses the floating mic |
| Launch at login | Local machine | Windows OS startup item, not an app setting row |
| Android overlay, accessibility, floating mic on/off | Local machine | OS permissions and a live service, not a stored preference |
| Usage intelligence | Account | Same opt-out on every device; counters stay local |

Overlay layout and auto-start of the floating mic are not stored in this phase.

## Local dictation history

PV5 keeps the 75 most recent finalized dictations in local WebView storage. Each entry contains
only final text, timestamp, selected destination, and success/failure. It stores no audio and has
no Supabase service or migration. Malformed stored entries are ignored, persistence failures
leave the current in-memory recovery list available, and Clear history replaces the local list
with an empty one.

## Failure recovery

Maintain the current utterance locally until:

- final transcript is received and delivered to its selected destination, or
- the user cancels, or
- recovery definitively fails

Recovery may use the same Google provider through a non-live transcription path if current APIs support it cleanly.

Do not add a second speech vendor solely for fallback.

As implemented (Phase 3, `src/voice/session/DictationController.ts`):

- Each press-to-release is one `Utterance` object. It owns the capture, the live session, and an in-memory PCM buffer. The object is dropped when the utterance is delivered, cancelled, or fails, so the buffer never outlives it and is never written to disk. Every async continuation checks that its `Utterance` is still current, so a stale final or recovery result cannot be delivered.
- The live path is a small tagged state per utterance (`connecting`, `streaming`, `ending`, `lost`) instead of lifecycle booleans. The visible lifecycle is still the `voiceReducer` states.
- Provider errors carry `retryable`. A retryable loss of the live session (network drop, connect or final-transcript timeout, `goAway`) keeps recording if the user is still speaking. On release the buffered audio goes to `VoiceProvider.transcribeRecording`. For Gemini that replays the buffer into a fresh Live session with a new ephemeral token, throttled by the socket's send buffer. Phase 3 first used a unary `generateContent` call, but ephemeral tokens are Live-only, so Phase 4 replaced it. The controller's recovery timeout is 30 s plus the utterance's length. A non-retryable error (signed out, not allowed, refused config) goes straight to ERROR.
- Release while still connecting finalizes immediately. The controller waits up to 2 s for the live session, then recovers from the buffer. Recordings under 250 ms are discarded as accidental taps. Recording auto-stops at 5 minutes.
- Phase 9: an empty transcript is an error ("No speech detected…"), not a silent success. Gemini sends `voiceActivity: ACTIVITY_END` after `activityEnd`. When no transcription is still in progress, `GeminiProvider` finishes 750 ms after that instead of waiting for the 10 s final timeout, so a silent recording now fails in about 1 s instead of about 25 s. The controller records per-utterance timings (`src/voice/session/timings.ts`), which dev builds log as `[latency] …`.

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
