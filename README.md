<p align="center">
  <img src="src-tauri/icons/icon.svg" alt="Personal Voice" width="80" height="80" />
</p>

<h1 align="center">Your Personal Voice App</h1>

<p align="center">
  <strong>Hold to talk. Clean text at the cursor.</strong><br />
  Or open Assistant for a live voice conversation.<br />
  One app for Windows and Android.
</p>

<p align="center">
  <code>Windows</code>
  &nbsp;·&nbsp;
  <code>Android</code>
  &nbsp;·&nbsp;
  <code>v0.3.16</code>
</p>

<p align="center">
  <a href="#how-it-works">How it works</a>
  &nbsp;·&nbsp;
  <a href="#what-you-can-do">Features</a>
  &nbsp;·&nbsp;
  <a href="#privacy">Privacy</a>
  &nbsp;·&nbsp;
  <a href="#stack">Stack</a>
  &nbsp;·&nbsp;
  <a href="#development">Development</a>
</p>

---

## How it works

```text
Press → Speak → Release → Clean text appears at the cursor
```

| Platform | Default control |
| --- | --- |
| **Windows** | Hold a global hotkey (or the floating mic) |
| **Android** | Hold the floating microphone to dictate, or hold the Note bubble to save directly to Notes |

Text can go into the focused field, a voice note, or another device's active cursor via Remote Dictation.

---

## What you can do

| Area | Capabilities |
| --- | --- |
| **Dictation** | Hold-to-talk · Gemini cleanup (punctuation, caps, cleanup) · personal dictionary · destinations: active field, voice note, or Remote Dictation |
| **Cross-device** | Remote Dictation (tap to choose device, hold to speak, release to paste at the other cursor) · Handoffs inbox · shared clipboard (explicit send only) · rename, list, and remove installs |
| **Capture & history** | Selection capture · last 75 dictations on device · optional Sync dictations |
| **Assistant** | Separate Gemini Live chat (voice or typed) · floating control / Windows hotkey · attach selection, notes, or handoffs · optional camera photo / live Camera Context · optional Windows remote reads and confirmable desktop actions |
| **Account & controls** | Email/password sync · device-scoped mic, hotkeys, overlay, destination · opt-in analytics · Windows updater / Android APK releases |

---

## Privacy

| Default | Behavior |
| --- | --- |
| Microphone audio | Client → Gemini only. Never proxied through our backend. |
| Storage | Audio is not permanently stored by the app. |
| Sync | Notes and handoffs sync only when you choose those destinations. |
| History | Local by default. Cloud only if Sync dictations is on. Selection stays in memory. |
| Analytics | Opt-in daily counters. No transcript or audio warehouse. |

---

## Stack

| Layer | Tech |
| --- | --- |
| App shell | Tauri 2 · React · TypeScript · Rust |
| Android native | Kotlin platform plugin |
| Transcription | Gemini Live (dictation) |
| Assistant | Gemini Live (conversation) |
| Backend | Supabase (auth, sync, short-lived tokens) |

Gemini API keys stay on the server. The client gets short-lived tokens only.

---

## Development

> Before changing code: [`AGENTS.md`](AGENTS.md) · [`docs/SPEC.md`](docs/SPEC.md) · [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
>
> Also: [`WINDOWS.md`](docs/WINDOWS.md) · [`ANDROID.md`](docs/ANDROID.md) · [`BACKEND_SYNC.md`](docs/BACKEND_SYNC.md) · [`RELEASING.md`](docs/RELEASING.md)

### Quick start (Windows)

**Needs:** Node 22.12+ · pnpm 11.25.0 · MSVC Build Tools · WebView2 · Rust (via rustup; see `rust-toolchain.toml`)

```powershell
# Client env: copy .env.example → .env.local (URL + publishable key only)
pnpm install --frozen-lockfile
pnpm tauri dev
```

```powershell
# If rustc is missing from PATH after a fresh install:
$env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path"
```

### Validate

```powershell
pnpm check          # lint + typecheck + test
pnpm build          # frontend assets only
pnpm tauri build --debug --no-bundle
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo check --locked --manifest-path src-tauri/Cargo.toml
cargo clippy --locked --manifest-path src-tauri/Cargo.toml -- -D warnings
```

`pnpm dev` is Vite only (not the native app). Releases: [`docs/RELEASING.md`](docs/RELEASING.md).

<details>
<summary><strong>Client config</strong></summary>

```text
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

Never put a Gemini API key or Supabase service-role key in the client.

</details>

<details>
<summary><strong>Android setup</strong></summary>

Install Android Studio (JDK, SDK, Platform-Tools, Build-Tools, Command-line Tools, NDK). Enable Windows Developer Mode if Tauri asks for symlinks.

```powershell
$env:JAVA_HOME = 'C:\Program Files\Android\Android Studio\jbr'
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
$env:NDK_HOME = "$env:ANDROID_HOME\ndk\28.2.13676358"
rustup target add aarch64-linux-android
pnpm tauri android init
pnpm tauri android build --debug --target aarch64 --apk
pnpm tauri android dev   # device or emulator
```

APKs: `src-tauri/gen/android/app/build/outputs/`. Details: [`docs/ANDROID.md`](docs/ANDROID.md).

</details>

<details>
<summary><strong>Repo layout</strong></summary>

```text
src/
├── app/                   Settings shell, nav, dictation wiring
├── voice/                 Provider boundary, session, audio, destinations
├── assistant/             Gemini Live Assistant session and tools
├── platform/              Windows / Android adapters + capture
├── overlay/               Floating control
├── onboarding/            First-run setup
├── auth/ settings/ sync/  Account, device prefs, dictionary
├── notes/ handoffs/ …     Notes, handoffs, history, devices, usage, updates
└── services/              Supabase and Edge Function clients

src-tauri/
├── src/
│   ├── commands/          Tauri IPC
│   ├── platform/          OS-specific Rust
│   └── voice/
└── gen/android/           Generated host + Kotlin platform code

supabase/
└── functions/             gemini-token and related Edge Functions
```

Shared logic stays in TypeScript. Platform behavior stays behind `PlatformAdapter`. Dictation uses `VoiceProvider` / `TranscriptionSession`. Assistant uses `AssistantController`. Camera Context uses `CameraCapture` (`createCamera()`): Windows webcams via WebView `getUserMedia`, Android via CameraX in the Kotlin plugin. Frames go to Gemini Live only (≤ 1 FPS); Personal Voice does not store them. See [`docs/Camera-Context-Phases/`](docs/Camera-Context-Phases/README.md).

</details>

<details>
<summary><strong>Filesystem note (exFAT)</strong></summary>

This workspace uses exFAT. pnpm 11's `nodeLinker` is hoisted in `pnpm-workspace.yaml` because exFAT cannot create dependency symlinks.

Android APK builds from this exFAT workspace stop when Tauri links the native library. Use an NTFS checkout with symlink support for Android builds. The generated host targets SDK 37.

</details>
