# Phase 7 implementation report — Packaging

## Scope

Only `prompts/07-packaging.md`: an installable Windows NSIS installer, a release APK signed with one permanent key, a single app version, and documented build commands. There's no update checking, no commercial code signing, and no CI workflow.

## Artifacts

In `release/` (gitignored), with `SHA256SUMS.txt`:

| File | Size |
| --- | --- |
| `PersonalVoice-0.1.0-Setup.exe` | 1.44 MiB, per-user NSIS installer, unsigned |
| `PersonalVoice-0.1.0.apk` | 10.2 MiB, universal (arm64-v8a + x86_64), signed with the permanent release key |

Build steps, the key location, backup instructions, and CI variables are in `docs/RELEASING.md`.

## Deviations from the prompt/docs

- **Installer name.** Tauri names the file `Personal Voice_<version>_x64-setup.exe`, after `productName`. The copy in `release/` is `PersonalVoice-<version>-Setup.exe`, not `VoiceApp-Setup.exe`, so the version is visible and old installers don't overwrite each other. Renaming the product to get Tauri's name to match would also rename the install folder and Start menu entry.
- **Per-user install** (`installMode: currentUser`). It needs no admin prompt, and the app only ever runs for one user.
- **No signing on Windows yet.** SmartScreen warns on first run. `digestAlgorithm: sha256` is set; adding `certificateThumbprint` or `signCommand` is all that's needed later (`RELEASING.md`).
- **The Android release build uses the NTFS-mirror workaround** from Phase 6, because the repo's exFAT drive can't hold the symlink Tauri creates. The Gradle signing config itself is standard and works unchanged in CI.

## Changes

- `src-tauri/tauri.conf.json`: `version` reads `../package.json`, so there's one version source. NSIS target only, publisher and description, per-user install mode, SHA-256 digest.
- `src-tauri/gen/android/app/build.gradle.kts`: `release` signing config from the gitignored `keystore.properties` or `ANDROID_KEYSTORE_*` environment variables. Without either, the APK is unsigned rather than debug-signed.
- `src/version.test.ts`: fails `pnpm check` if `package.json`, `tauri.conf.json`, and `Cargo.toml` disagree on the version.
- `.gitignore`: `*.p12`, `keystore.properties`, `release/` (`*.jks` and `*.keystore` were already there).
- Docs: new `RELEASING.md`; pointers from `ANDROID.md` and `TESTING_RELEASES.md`.
- Outside the repo: the release keystore at `%USERPROFILE%\.personal-voice\signing\personal-voice-release.jks` (PKCS12, RSA 4096, alias `personal-voice`, valid to 2126) and its `keystore.properties`. A copy of the properties file sits in `src-tauri/gen/android/` (gitignored) so local builds sign.

No Rust or app code changed.

## Checks

| Check | Result |
| --- | --- |
| `pnpm check` (lint, typecheck, tests) | PASS, 12 files / 91 tests |
| `pnpm tauri build` | PASS, `Personal Voice_0.1.0_x64-setup.exe` |
| Gradle `assembleUniversalRelease` | PASS |
| `apksigner verify --print-certs` | v2 signature, SHA-256 `5942d721…77106759` matches the keystore |

### Windows (this PC)

| Check | Result |
| --- | --- |
| Silent install (`/S`): exit 0, no admin, `%LOCALAPPDATA%\Personal Voice`, Start menu shortcut, uninstall entry 0.1.0 | PASS |
| Installed app launches and shows its window | PASS |
| Upgrade 0.1.0 to a test 0.1.1 build: registry and exe report 0.1.1, app runs, WebView2 data files and Supabase auth entry still present | PASS |
| Reinstall the same version without launching: app data byte-identical (6/6 files) | PASS |
| Silent uninstall: program folder removed, app data kept | PASS |
| Final 0.1.0 installer reinstalled over the test build, launches | PASS |

The upgrade test used a throwaway build (`--config '{"version":"0.1.1"}'`), deleted afterwards. The PC now has 0.1.0 installed.

### Android (emulator, Pixel 10 Pro, API 37)

| Check | Result |
| --- | --- |
| The release APK installs after uninstalling the debug build, launches, and shows the shared UI. The plugin bridge works after R8 (microphone shows **Done**) | PASS |
| A debug-signed APK over the release install: rejected with `INSTALL_FAILED_UPDATE_INCOMPATIBLE` | PASS (expected) |
| A same-key 0.1.1 (`versionCode` 1001) APK over 0.1.0 (1000): `Success`, same `firstInstallTime`, same signature, microphone and overlay grants kept, app relaunches | PASS |

The 0.1.1 APK was built by editing the generated `tauri.properties` in the mirror only, then restored. The emulator is back on 0.1.0.

The emulator image has no root, and release WebViews can't be inspected, so Android app data couldn't be read directly. Data survival rests on Android's standard behavior: an update keeps the app's data directory whenever the package and signature match. The table above shows the package was updated in place, not reinstalled.

## Not yet verified (needs you)

1. **Back up the signing key now.** Copy `%USERPROFILE%\.personal-voice\signing\personal-voice-release.jks` off this machine, and put the password from the `keystore.properties` beside it into your password manager. If the key is lost, the phone has to uninstall, losing its data, before it can take any future build.
2. **Install on the Samsung.** If a debug build is on the phone, uninstall it once. Then install `release\PersonalVoice-0.1.0.apk` (copy it over and open it, or `adb install`). This also replaces step 1 of the Phase 6 device test.
3. **Update test on the phone:** sign in and add a dictionary term, then install the next release (e.g. 0.1.1) over it. The sign-in and term should still be there.
4. **Windows data after upgrade with a real session:** sign in to the installed app once. Your dev sign-in doesn't carry over (a different origin), then confirm it stays signed in after the next installer runs over it.

Also: the project folder isn't a git repository yet, so nothing is committed. Run `git init` before the first commit, and check that `git status` doesn't list `keystore.properties` or `release/`.

Phase 7 packaging is done on this PC and the emulator. The on-device install and update above are the remaining acceptance steps. Update checking wasn't started.
