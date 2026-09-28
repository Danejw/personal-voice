# Releasing

Releases are published from GitHub Actions to [Danejw/personal-voice](https://github.com/Danejw/personal-voice/releases). Installed apps find them there: Windows through Tauri's updater, Android through the release's APK.

## Version

There is one app version, in `package.json`. `src-tauri/tauri.conf.json` reads it (`"version": "../package.json"`), and `src-tauri/Cargo.toml` must match. `src/version.test.ts` fails `pnpm check` if they drift.

Android's `versionName` and `versionCode` are derived by Tauri at build time into `gen/android/app/tauri.properties` (`0.1.0` becomes `1000`, `0.1.1` becomes `1001`, `0.2.0` becomes `2000`). Every release must bump the version, or Android refuses to install it over the previous one and the Windows updater doesn't offer it.

## Publishing a release

1. Bump `version` in `package.json` and `src-tauri/Cargo.toml` (SemVer, pre-1.0: `0.2.0`, `0.3.0`, ...).
2. Run `pnpm check`, then commit and push.
3. Tag and push the tag:

   ```powershell
   git tag -a v0.3.0 -m "Personal Voice 0.3.0"
   git push origin v0.3.0
   ```

`.github/workflows/release.yml` then:

1. checks that the tag matches `package.json` and `Cargo.toml`, and creates a **draft** release with generated notes;
2. on Windows, runs `pnpm check`, builds the installer, and uploads `PersonalVoice-<v>-Setup.exe`, its updater signature `.sig`, and `latest.json`;
3. on Linux, builds the APK signed with the release key, refuses to continue unless its certificate matches the release key's SHA-256, and uploads `PersonalVoice-<v>.apk`;
4. writes `SHA256SUMS.txt` and publishes the release as latest.

Installed apps only see published releases, so a failed run never offers a half-built update. To retry, fix the problem and re-run the failed jobs; the uploads overwrite. To abandon a version, delete the draft and the tag.

The release notes shown in the app's Updates section are the release's body. Edit the draft before step 4 finishes, or edit the release afterwards (Windows reads the notes from `latest.json`, which is written at build time).

### CI secrets and variables

Set in the repo's **Settings → Secrets and variables → Actions**:

| Name | Kind | Value |
| --- | --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY` | secret | contents of `updater.key` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | secret | contents of `updater.password` |
| `ANDROID_KEYSTORE_BASE64` | secret | the `.jks`, base64 |
| `ANDROID_KEYSTORE_PASSWORD` | secret | `password` from `keystore.properties` |
| `VITE_SUPABASE_URL` | variable | from `.env.local` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | variable | from `.env.local` (client-safe) |

To set them again from this machine (values aren't printed):

```powershell
$dir = "$env:USERPROFILE\.personal-voice\signing"; $r = "Danejw/personal-voice"
gh secret set TAURI_SIGNING_PRIVATE_KEY --repo $r --body ((Get-Content "$dir\updater.key" -Raw).Trim())
gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD --repo $r --body ((Get-Content "$dir\updater.password" -Raw).Trim())
gh secret set ANDROID_KEYSTORE_BASE64 --repo $r --body ([Convert]::ToBase64String([IO.File]::ReadAllBytes("$dir\personal-voice-release.jks")))
gh secret set ANDROID_KEYSTORE_PASSWORD --repo $r --body ((Get-Content "$dir\keystore.properties" | Where-Object { $_ -match '^password=' }) -replace '^password=', '')
```

## Signing keys

Both keys live in `%USERPROFILE%\.personal-voice\signing\`, outside the repo. **Back up that whole folder off this machine** (an encrypted USB drive, or attachments in a password manager), and keep the passwords in a password manager too. Never commit any of it. The folder is outside the repo, and `.gitignore` also excludes `*.jks`, `*.keystore`, `*.p12`, `*.pem`, and `keystore.properties` in case a copy lands inside it.

| Key | Files | If it's lost |
| --- | --- | --- |
| Windows updater (minisign) | `updater.key`, `updater.password`; public key in `tauri.conf.json` `plugins.updater.pubkey` | Installed apps reject every future update. Each PC has to download and run a new installer by hand once. |
| Android release | `personal-voice-release.jks`, `keystore.properties` | Every phone has to uninstall, losing its app data, before it can install a newer build. |

Restoring on a new machine is copying the folder back. Don't generate new keys.

## Local builds

CI is the normal path. These are for testing a build before tagging.

### Windows installer

`createUpdaterArtifacts` makes `tauri build` sign the installer for the updater, so it needs the updater key:

```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
$env:TAURI_SIGNING_PRIVATE_KEY = (Get-Content "$env:USERPROFILE\.personal-voice\signing\updater.key" -Raw).Trim()
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = (Get-Content "$env:USERPROFILE\.personal-voice\signing\updater.password" -Raw).Trim()
pnpm tauri build
```

Output: `src-tauri/target/release/bundle/nsis/Personal Voice_<version>_x64-setup.exe` plus `.sig`. Copy it to `release/PersonalVoice-<version>-Setup.exe` (the `release/` folder is gitignored).

The installer is per-user (`installMode: currentUser`): no admin prompt, installs to `%LOCALAPPDATA%\Personal Voice`, adds a Start menu shortcut and an uninstall entry. Silent install for testing: `.\PersonalVoice-<version>-Setup.exe /S`.

#### App data across upgrades

App data (sign-in session, cached dictionary, settings) lives in the WebView2 profile at `%LOCALAPPDATA%\com.personal.voiceapp\`, keyed on the bundle identifier. Installing a newer or the same version over an existing install keeps it. Uninstalling keeps it too, unless the "Delete app data" box is ticked in the uninstaller.

- **Never change `identifier`** in `tauri.conf.json` (`com.personal.voiceapp`). It keys both the Windows data folder and the Android package, so changing it orphans all data and breaks Android updates.
- Data from `pnpm tauri dev` isn't shared with installed builds: dev loads from `http://localhost:1420`, installed builds from `http://tauri.localhost`, and localStorage is per origin. Sign in once in the installed app.

#### Code signing (optional, later)

The installer is unsigned, so SmartScreen shows "Windows protected your PC" when it's run by hand. For a personal build, click **More info**, then **Run anyway**. In-app updates don't show that prompt. Authenticode signing is separate from the updater's minisign signature, which is always required.

`tauri.conf.json` already sets `bundle.windows.digestAlgorithm: "sha256"`. To sign later, add one of these under `bundle.windows`, then rebuild:

- `"certificateThumbprint": "<thumbprint>"` for a certificate in the Windows certificate store, plus `"timestampUrl"` from the certificate vendor.
- `"signCommand": "<command> %1"` for a cloud or HSM signer (e.g. Azure Trusted Signing).

Keep certificates and signer credentials out of the repository.

### Android APK

#### The signing key

All Android releases must be signed with one permanent key. Android only installs an update over an existing app when both are signed with the same key.

| | |
|---|---|
| Keystore | `%USERPROFILE%\.personal-voice\signing\personal-voice-release.jks` (PKCS12, RSA 4096, valid to 2126) |
| Alias | `personal-voice` |
| Password | in `%USERPROFILE%\.personal-voice\signing\keystore.properties` (store and key share it) |
| SHA-256 | `59:42:D7:21:85:5A:77:04:20:A1:37:37:94:B2:49:9D:F3:1A:73:05:8B:C5:90:3D:B6:48:07:FB:77:10:67:59` |

#### How the build finds the key

`src-tauri/gen/android/app/build.gradle.kts` signs the `release` build type from, in order:

1. `src-tauri/gen/android/keystore.properties` (gitignored), for local builds:

   ```properties
   storeFile=C:\\Users\\<you>\\.personal-voice\\signing\\personal-voice-release.jks
   password=<keystore password>
   keyAlias=personal-voice
   ```

   Copy it from `%USERPROFILE%\.personal-voice\signing\keystore.properties`.

2. Environment variables, for CI: `ANDROID_KEYSTORE_PATH`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`. The release workflow decodes `ANDROID_KEYSTORE_BASE64` to a temp file and deletes it afterwards.

If neither is present, the release APK is built unsigned (`app-universal-release-unsigned.apk`) and won't install.

#### Build

The repo lives on an exFAT drive, where `tauri android build` fails at its symlink step (see `docs/ANDROID.md`, "Building on this machine"). Until the repo moves to NTFS with Developer Mode on, build from an NTFS mirror:

```powershell
$src = "E:\Desktop\VoiceDictationAPP"; $dst = "C:\dev\VoiceDictationAPP-android"
robocopy $src $dst /MIR /XD "$src\node_modules" "$dst\node_modules" "$src\src-tauri\target" "$dst\src-tauri\target" "$src\dist" "$dst\dist" "$src\release" "$dst\release" "$src\src-tauri\gen\android\app\build" "$dst\src-tauri\gen\android\app\build" "$src\src-tauri\gen\android\.gradle" "$dst\src-tauri\gen\android\.gradle" "$src\src-tauri\gen\android\build" "$dst\src-tauri\gen\android\build" "$src\src-tauri\gen\android\app\src\main\jniLibs" "$dst\src-tauri\gen\android\app\src\main\jniLibs"
cd $dst; pnpm install

# 1. Compile the Rust library once per ABI. Each run fails at the symlink step after compiling; that's expected.
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
pnpm tauri android build --apk --target aarch64
pnpm tauri android build --apk --target x86_64

# 2. Place the libraries where Gradle expects them.
$g = "$dst\src-tauri\gen\android"
Remove-Item "$g\app\src\main\jniLibs" -Recurse -Force -ErrorAction SilentlyContinue
foreach ($p in @(@("aarch64","arm64-v8a"), @("x86_64","x86_64"))) {
  New-Item -ItemType Directory -Force "$g\app\src\main\jniLibs\$($p[1])" | Out-Null
  Copy-Item "$dst\src-tauri\target\$($p[0])-linux-android\release\libpersonal_voice_app_lib.so" "$g\app\src\main\jniLibs\$($p[1])\"
}

# 3. Package and sign.
cd $g
.\gradlew.bat assembleUniversalRelease -x rustBuildUniversalRelease -x rustBuildArm64Release -x rustBuildX86_64Release "-PabiList=arm64-v8a,x86_64" "-ParchList=arm64,x86_64" "-PtargetList=aarch64,x86_64"
```

Check that `gen/android/app/tauri.properties` shows the new version before step 3; step 1 writes it.

Output: `gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk`. Copy it to `release/PersonalVoice-<version>.apk`. The x86_64 library is only for the emulator; a phone-only build can skip that target and use `arm64-v8a` / `arm64` / `aarch64` alone.

Verify the signature before installing anywhere. The SHA-256 must match the table above:

```powershell
& "$env:LOCALAPPDATA\Android\Sdk\build-tools\<version>\apksigner.bat" verify --print-certs release\PersonalVoice-<version>.apk
```

On a machine where symlinks work, steps 1–3 collapse into `pnpm tauri android build --apk` (that's what CI runs).

## Installing and updating

- **Windows, first time:** download `PersonalVoice-<v>-Setup.exe` from the latest release and run it. After that, the app's **Updates** section offers each new release: **Install and restart** downloads it, verifies its signature against the built-in public key, and runs the installer, which closes the app and reopens it. The button waits while dictation is running.
- **Android, first time:** a debug build (from `pnpm tauri android dev` or a debug APK) is signed with a different key. Uninstall it once, then open `PersonalVoice-<v>.apk` from the release on the phone. After that, the app's **Updates** section shows a newer release: **Download update** opens the APK in the browser, and opening the download shows Android's own "Do you want to update this app?" screen. The first time, Android asks you to allow installs from the browser. Android refuses an APK signed with any other key.
- **Updates keep data** on both: sign-in, cached dictionary, settings, and Android's granted permissions.
- The app checks once at startup (silently if offline) and when you tap **Check for updates**. It never installs anything without a tap.

## Checksums

CI attaches `SHA256SUMS.txt` to every release. For local builds, after copying both artifacts into `release/`:

```powershell
Get-FileHash release\PersonalVoice-* -Algorithm SHA256 | ForEach-Object { "$($_.Hash.ToLower())  $(Split-Path $_.Path -Leaf)" } | Set-Content release\SHA256SUMS.txt
```
