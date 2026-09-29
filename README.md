# Personal Voice

Cross-device system-wide dictation for Windows and Android. One Tauri 2 app: hold to talk, release, and cleaned text lands at the cursor (or another destination you choose).

```text
Press → Speak → Release → Clean text appears at the cursor
```

Stack: Tauri 2, React, TypeScript, Rust, Android Kotlin where native services are required, Gemini Live for transcription, Supabase for auth/sync/tokens.

## What works today

- **Hold-to-talk dictation** — Windows global push-to-talk (multiple bindings per action: keyboard and/or mouse); Android floating microphone
- **Smart transcription** — punctuation, capitalization, and cleanup via Gemini; no second LLM pass
- **Personal dictionary** — curated terms synced across devices
- **Destinations** — insert into the focused field, save a voice note, or send to another of your devices
- **Shared clipboard** — explicitly paste or type text and send it to a device (no OS clipboard monitoring)
- **Cross-device handoff** — pending text on other installs; Windows toast to insert without opening Settings
- **Selection capture** — grab highlighted text (Windows clipboard snapshot / Android focused editable selection)
- **Recent dictation history** — last 75 finals on this device only (local, clearable; no cloud transcript warehouse)
- **Account sync** — email/password auth; dictionary and transcription preferences; device-scoped mic, hotkeys, and default destination
- **Devices** — rename this install, list other installs, remove old ones
- **Analytics** — opt-in daily usage rollups (words, destinations, apps); no transcript or audio stored
- **Updates** — Windows signed installer via Tauri updater; Android APK from GitHub Releases
- **Recovery** — retryable live-session loss replays the in-memory utterance buffer; audio is never written to disk or sent through Supabase

Version is `0.3.3` in `package.json` (kept in sync with `src-tauri/Cargo.toml`).

## Source of truth

Read `AGENTS.md`, `docs/SPEC.md`, `docs/ARCHITECTURE.md`, and the active prompt before changing code.

| Docs | Contents |
| --- | --- |
| `docs/PHASE_*_REPORT.md` | V1 phases 0–9 |
| `docs/PV-Phases/` | Personal Voice work after V1 (completed vs skipped) |
| `docs/WINDOWS.md` / `docs/ANDROID.md` | Platform behavior |
| `docs/BACKEND_SYNC.md` | Supabase schema and sync |
| `docs/RELEASING.md` | Tags, CI, signing, GitHub Releases |

## Client config

Copy `.env.example` to `.env.local` and set the project URL and publishable key only. Never put a Gemini API key or Supabase service-role key in the client.

```text
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

Short-lived Gemini credentials come from the authenticated `gemini-token` Edge Function. Live mic audio goes client → Gemini only.

## Windows setup

Install Node.js 22.12+ (tested with 22.19), pnpm 11.25.0, Microsoft C++ Build Tools with Desktop development with C++, and WebView2. Install Rust through rustup; `rust-toolchain.toml` pins the compiler and rustfmt/clippy. Ensure `%USERPROFILE%\.cargo\bin` is on PATH.

```powershell
pnpm install --frozen-lockfile
pnpm tauri dev
```

If Rust was just installed and is not yet on PATH:

```powershell
$env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path"
```

## Validation commands

From the repository root:

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm build
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo check --locked --manifest-path src-tauri/Cargo.toml
cargo clippy --locked --manifest-path src-tauri/Cargo.toml -- -D warnings
pnpm tauri build --debug --no-bundle
```

`pnpm check` runs lint, strict typechecking, and tests. `pnpm build` is frontend assets only. `pnpm tauri build` produces the Windows binary under `src-tauri/target/`. `pnpm dev` is a frontend preview, not a native launch. Release packaging is documented in `docs/RELEASING.md`.

## Android setup (same application)

Install Android Studio, its bundled JDK, SDK Platform, Platform-Tools, Build-Tools, Command-line Tools, and the side-by-side NDK. Set paths to the versions on your machine:

```powershell
$env:JAVA_HOME = 'C:\Program Files\Android\Android Studio\jbr'
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
$env:NDK_HOME = "$env:ANDROID_HOME\ndk\28.2.13676358"
rustup target add aarch64-linux-android
pnpm tauri android init
pnpm tauri android build --debug --target aarch64 --apk
# With a connected device or running emulator:
pnpm tauri android dev
```

Use Windows Developer Mode if Tauri requests symlink support. APKs land under `src-tauri/gen/android/app/build/outputs/`. Native capture, floating mic, accessibility insertion, and overlay live in the inlined Android platform plugin (`docs/ANDROID.md`).

## Layout

```text
src/
├── app/                 Settings shell, nav, dictation wiring
├── voice/               Provider boundary, session, audio, destinations
├── platform/            Windows / Android adapters + capture
├── auth/ settings/ sync/  Account, device prefs, dictionary
├── notes/ handoffs/ history/ devices/ context/ usage/ updates/
└── services/            Supabase and Edge Function clients

src-tauri/src/
├── commands/            Tauri IPC
├── platform/            OS-specific Rust (Windows + Android registration)
└── voice/

src-tauri/gen/android/   Generated host + Kotlin platform code
supabase/functions/      gemini-token and related Edge Functions
```

Shared product logic stays in TypeScript. Platform behavior stays behind `PlatformAdapter`. Gemini stays behind `VoiceProvider` / `TranscriptionSession`.

## Privacy defaults

- Live microphone audio does not go through our backend
- Audio is not permanently stored by the app
- Voice notes and handoffs sync only when you choose those destinations
- Recent history and selection captures stay on-device (selection is in-memory)
- Analytics are daily counters only; turn off or clear from Settings

## Filesystem note

This workspace uses exFAT. pnpm 11's `nodeLinker` is hoisted in `pnpm-workspace.yaml` because exFAT cannot create dependency symlinks. This remains a single-package project.

Android APK builds from this exFAT workspace stop when Tauri links the native library. Use an NTFS checkout with symlink support for Android builds. The generated host targets SDK 37; install that SDK platform before completing Gradle assembly.
