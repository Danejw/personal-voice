# Phase 8 implementation report — Releases and updates

## Scope

Only `prompts/08-updates.md`: a tag-triggered GitHub Actions release that builds both platforms, the Tauri updater on Windows, and a notify-and-download flow on Android. There's no silent Android install, no update server, and nothing from Phase 9.

The repo is now on GitHub, public: [Danejw/personal-voice](https://github.com/Danejw/personal-voice). The update files have to be downloadable by installed apps without a token, so they're public. Two releases have been published: [v0.2.0](https://github.com/Danejw/personal-voice/releases/tag/v0.2.0) (the first with the updater) and [v0.2.1](https://github.com/Danejw/personal-voice/releases/tag/v0.2.1) (published to test the update itself).

## How it works

- **Release:** pushing a `vX.Y.Z` tag runs `.github/workflows/release.yml`. It checks that the tag matches the app version and creates a draft. Windows builds the installer, its minisign `.sig`, and `latest.json`. Linux builds the APK and fails unless its certificate matches the release key's SHA-256. The last job adds `SHA256SUMS.txt` and publishes. Installed apps never see a draft, so a failed run offers nothing.
- **Windows:** `tauri-plugin-updater` reads `latest.json` from the latest release and verifies the installer against the public key in `tauri.conf.json`. `requireSignedVersion` makes it reject a signature made for a different version. It then runs the NSIS installer in passive mode, which closes the app and reopens it.
- **Android:** the app reads GitHub's latest-release API, and only accepts `PersonalVoice-<tag version>.apk` from this repo's downloads. **Download update** opens that link in the browser through a new Kotlin command that only opens `https://github.com` URLs. Android's package installer handles the rest.
- **Shared:** `PlatformAdapter.checkForUpdate()`. `src/updates/` holds the version comparison, release parsing, and the `updateReducer` state machine. The **Updates** section shows the installed version, the new version and its notes, and one button. The app checks at startup (quietly if offline) and on **Check for updates**. Install is disabled while dictating.

## Deviations from the prompt/docs

- **No `tauri-action`.** The workflow runs `pnpm tauri build` and writes `latest.json` itself (the documented static format). That keeps the asset names fixed (`PersonalVoice-<v>-Setup.exe`, `PersonalVoice-<v>.apk`) and every action pinned to a commit.
- **No `tauri-plugin-process`.** The docs pair the updater with `relaunch()`, but on Windows the updater exits the app and passes the NSIS installer its restart flag, so the installer reopens the app itself (checked in the plugin source, and in the test below).
- **Play Protect.** Current Android shows "App blocked to protect your device" for a sideloaded APK from a developer it hasn't seen, even after the package installer's Update prompt. The platform offers **More details → Install anyway**. Following the prompt's "follow current platform rules", the in-app hint and `RELEASING.md` now say so. The hint change ships in the next release.
- **`serde_json` added to `Cargo.toml`.** `generate_context!` needs it once `tauri.conf.json` has a `plugins` section. The default Tauri template includes it; this project had dropped it.

## Changes

- **CI:** `.github/workflows/release.yml`; `.gitattributes` keeps `gradlew` LF for the Linux runner.
- **Rust:** `tauri-plugin-updater =2.13.0` (desktop only), registered under `#[cfg(desktop)]`; `serde_json =1.0.151`; `build.rs` declares `open_download`.
- **Config:** `tauri.conf.json` has `plugins.updater` (pubkey, GitHub endpoint, `requireSignedVersion`, passive install), `createUpdaterArtifacts`, and `https://api.github.com` in the CSP. Capabilities: new `desktop.json` (`updater:default`, Windows main window only); `default.json` gains `core:app:allow-version`.
- **Kotlin:** `VoicePlatformPlugin.openDownload`.
- **TypeScript:** `@tauri-apps/plugin-updater 2.13.0`; `AvailableUpdate` and `checkForUpdate()` on both adapters; `src/services/releaseService.ts`; `src/updates/` (`version`, `githubRelease`, `updateState`, `useUpdates`, `UpdatePanel`, with tests); the Updates section in `App.tsx`; `.release-notes` in `app.css`.
- **Version:** 0.2.0, then 0.2.1.
- **Docs:** `RELEASING.md` (publishing, CI secrets, both signing keys, install and update steps), `ARCHITECTURE.md`, `TESTING_RELEASES.md`.
- **Also:**
  - The fake API key in `GeminiProvider.test.ts` is split so GitHub secret scanning doesn't flag it.
  - The two empty `crash-*.txt` files were deleted.
  - Git's `safe.directory` now includes this folder, which exFAT's lack of file ownership requires.
- **Outside the repo:** a new updater key pair in `%USERPROFILE%\.personal-voice\signing\` (`updater.key`, `updater.key.pub`, `updater.password`). Six repo secrets and variables are set on GitHub (listed in `RELEASING.md`).

## Checks

| Check | Result |
| --- | --- |
| `pnpm check` (lint, typecheck, tests) | PASS, 15 files / 111 tests. New tests: version comparison, release parsing and URL restriction, the release service's 404/error/success paths, the update reducer, and config consistency (pubkey, endpoint repo, `requireSignedVersion`) |
| `cargo fmt --check`, `cargo clippy --all-targets -D warnings` | PASS |
| Android release build (NTFS mirror), Kotlin compile | PASS, `versionCode` 2000 |
| Release run for v0.2.0 | PASS, after one fix: the runner names the SDK platform `platforms;android-37.0`. The failed first run's draft was deleted and the tag re-pointed |
| Release run for v0.2.1 | PASS, all four jobs |
| Published assets | installer, `.sig`, `latest.json`, APK, `SHA256SUMS.txt`; checksums verified locally; `latest.json` and the API answer without auth |
| CI APK signature | matches the release key's SHA-256 |

### Windows (this PC)

| Check | Result |
| --- | --- |
| CI 0.2.0 installer over the installed 0.1.0 | PASS, silent, registry and exe 0.2.0 |
| Startup check with 0.2.0 published | PASS, "Version 0.2.0 is the latest." |
| After v0.2.1 published, **Check for updates** | PASS, "Version 0.2.1 is available." with the release notes and **Install and restart** |
| **Install and restart** | PASS: the app exited, the passive installer ran, and the app reopened by itself as 0.2.1 (exe and registry). The app-data folder was intact (778 files before, 779 after) |
| After restart | PASS, "Version 0.2.1 is the latest." |

### Android (emulator, API 37)

| Check | Result |
| --- | --- |
| CI 0.2.0 APK over the local 0.2.0 build | PASS, same key, same first-install time |
| Startup check with 0.2.1 published | PASS, "Version 0.2.1 is available." with **Download update** |
| **Download update** | PASS, Chrome opened the release download and saved `PersonalVoice-0.2.1.apk` |
| Opening the APK | Android asked once to allow installs from Chrome, then showed "Update this app?" |
| **Update** | Play Protect blocked it as an unknown developer; **More details → Install anyway** installed it |
| Result | PASS, `versionCode` 2001 / 0.2.1, same first-install time, microphone grant kept, app shows "Version 0.2.1 is the latest." |

## Not yet verified (needs you)

1. **Back up the signing folder again.** It now also holds the updater key. Losing `updater.key` means every Windows install needs a manual reinstall to take future updates.
2. **On the Samsung:** install `PersonalVoice-0.2.1.apk` from the [latest release](https://github.com/Danejw/personal-voice/releases/latest), uninstalling a debug build first if one is there. The next release will then show up in the app. Samsung may add its own "Auto Blocker" or unknown-sources step alongside Play Protect.
3. **Data across a real update:** sign in and add a dictionary term before the next release, then confirm both survive the in-app update on each platform. The tests above ran signed out; app data was preserved, but no session was in it.
4. The installed Windows app is 0.2.1 now. Your `pnpm tauri dev` instance was left running.

Phase 8 is complete on this PC and the emulator. Phase 9 wasn't started.
