# Personal Voice

Phase 0 foundation for one Windows + Android Tauri 2 application. React/strict TypeScript provides the shared UI; Rust is the native host. Dictation is not implemented yet.

## Source of truth

Read `AGENTS.md`, every file in `docs/`, and the active prompt in `prompts/` before implementation. The original ZIP README is preserved as `BUILD_PACK_README.md`. Stop after each phase. See `docs/PHASE_0_REPORT.md` for validation results and remaining limitations.

## Windows setup

Install Node.js 22.12+ (tested with 22.19), pnpm 11.25.0, Microsoft C++ Build Tools with Desktop development with C++, and WebView2. Install Rust through rustup; `rust-toolchain.toml` pins the compiler and rustfmt/clippy components. Ensure `%USERPROFILE%\.cargo\bin` is on PATH. No API credentials are needed.

```powershell
pnpm install --frozen-lockfile
pnpm tauri dev
```

If Rust was just installed and is not yet on PATH, run this in the current PowerShell session:

```powershell
$env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path"
```

## Validation commands

Run from the repository root:

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

`pnpm check` runs lint, strict typechecking, and tests. `pnpm build` produces frontend assets only. The Tauri build produces the Windows executable in `src-tauri/target/debug/`; packaging/signing belongs to Phase 7. `pnpm dev` is a frontend preview only, not a native launch.

## Android setup (same application)

Install Android Studio, its bundled JDK, SDK Platform, Platform-Tools, Build-Tools, Command-line Tools, and the side-by-side NDK. Set paths to the versions actually installed on your machine:

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

Use Windows Developer Mode if Tauri requests symlink support. Android build artifacts live under `src-tauri/gen/android/app/build/outputs/`. Native dictation services and the Kotlin platform plugin belong to Phase 6; do not add them during foundation work.

## Boundaries and layout

- `src/app/`: shared React shell.
- `src/voice/provider/VoiceProvider.ts`: provider-neutral session and event interfaces; no provider implementation.
- `src/voice/session/`: explicit lifecycle reducer and focused tests. It defines transitions only; it does not orchestrate dictation.
- `src/platform/PlatformAdapter.ts`: native capture, insertion, and indicator contract; no implementation.
- `src/voice/audio`, `transcript`, `vocabulary`, plus `src/auth`, `settings`, `sync`, `components`: reserved architecture folders only.
- `src-tauri/src/`: mobile-compatible Rust entry point, with reserved `commands`, `platform`, and `voice` folders. Windows native behavior will stay here.
- `src-tauri/gen/android/`: Tauri-generated Android host, sharing the Rust library and frontend.

There are no credentials, provider connections, microphone access, hotkeys, overlays, insertion, accounts, sync, or assistant features in Phase 0. Provider-specific configuration and audio transport will be designed only when Phase 1 verifies the current official Gemini transcription API. No model ID is assumed in code.

## Official references checked for Phase 0

- [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)
- [Create a Tauri application](https://v2.tauri.app/start/create-project/)
- [Tauri Vite configuration](https://v2.tauri.app/start/frontend/vite/)

The scaffold uses official create-tauri-app 4.7.4, with demo commands, opener plugin, demo assets, and unused dependencies removed. Dependency versions and both lockfiles are retained for reproducibility. The generated Tauri icon is a development placeholder until packaging.

## Filesystem note

This workspace uses exFAT. pnpm 11's nodeLinker setting is stored in pnpm-workspace.yaml and set to hoisted because exFAT cannot create dependency symlinks. This remains a single-package project. See https://pnpm.io/settings for current configuration rules.


Android APK builds from this exFAT workspace stop when Tauri links the native library. Use an NTFS checkout with symlink support for Android builds. The generated host targets SDK 37; install that SDK platform before completing Gradle assembly. See docs/PHASE_0_REPORT.md for the exact tested limit.

