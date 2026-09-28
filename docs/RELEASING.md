# Releasing

How to produce the personal Windows installer and Android APK. Update checking is not built yet; releases are installed by hand.

## Version

There is one app version, in `package.json`. `src-tauri/tauri.conf.json` reads it (`"version": "../package.json"`), and `src-tauri/Cargo.toml` must match. `src/version.test.ts` fails `pnpm check` if they drift.

To release a new version:

1. Bump `version` in `package.json` and `src-tauri/Cargo.toml` (SemVer, pre-1.0: `0.2.0`, `0.3.0`, ...).
2. Run `pnpm check`.
3. Build both platforms below.

Android's `versionName` and `versionCode` are derived by Tauri at build time into `gen/android/app/tauri.properties` (`0.1.0` becomes `1000`, `0.1.1` becomes `1001`, `0.2.0` becomes `2000`). Every release must bump the version, or Android refuses to install it over the previous one.

## Windows installer

```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
pnpm tauri build
```

Output: `src-tauri/target/release/bundle/nsis/Personal Voice_<version>_x64-setup.exe`. Copy it to `release/PersonalVoice-<version>-Setup.exe` (the `release/` folder is gitignored).

The installer is per-user (`installMode: currentUser`): no admin prompt, installs to `%LOCALAPPDATA%\Personal Voice`, adds a Start menu shortcut and an uninstall entry. Silent install for testing: `.\PersonalVoice-<version>-Setup.exe /S`.

### App data across upgrades

App data (sign-in session, cached dictionary, settings) lives in the WebView2 profile at `%LOCALAPPDATA%\com.personal.voiceapp\`, keyed on the bundle identifier. Installing a newer or the same version over an existing install keeps it. Uninstalling keeps it too, unless the "Delete app data" box is ticked in the uninstaller.

- **Never change `identifier`** in `tauri.conf.json` (`com.personal.voiceapp`). It keys both the Windows data folder and the Android package, so changing it orphans all data and breaks Android updates.
- Data from `pnpm tauri dev` isn't shared with installed builds: dev loads from `http://localhost:1420`, installed builds from `http://tauri.localhost`, and localStorage is per origin. Sign in once in the installed app.

### Code signing (optional, later)

The installer is unsigned, so SmartScreen shows "Windows protected your PC" on first run. For a personal build, click **More info**, then **Run anyway**.

`tauri.conf.json` already sets `bundle.windows.digestAlgorithm: "sha256"`. To sign later, add one of these under `bundle.windows`, then rebuild:

- `"certificateThumbprint": "<thumbprint>"` for a certificate in the Windows certificate store, plus `"timestampUrl"` from the certificate vendor.
- `"signCommand": "<command> %1"` for a cloud or HSM signer (e.g. Azure Trusted Signing).

Keep certificates and signer credentials out of the repository.

## Android APK

### The signing key

All Android releases must be signed with one permanent key. Android only installs an update over an existing app when both are signed with the same key. A lost key means every device has to uninstall, losing its app data, before it can take a newer build.

| | |
|---|---|
| Keystore | `%USERPROFILE%\.personal-voice\signing\personal-voice-release.jks` (PKCS12, RSA 4096, valid to 2126) |
| Alias | `personal-voice` |
| Password | in `%USERPROFILE%\.personal-voice\signing\keystore.properties` (store and key share it) |
| SHA-256 | `59:42:D7:21:85:5A:77:04:20:A1:37:37:94:B2:49:9D:F3:1A:73:05:8B:C5:90:3D:B6:48:07:FB:77:10:67:59` |

**Back it up now:** copy the `.jks` file to at least one place off this machine (an encrypted USB drive, or an attachment in a password manager), and save the password in a password manager. The two are only useful together, so keep the password separate from any plain file copy of the `.jks`. Never commit either one; `.gitignore` excludes `*.jks`, `*.keystore`, `*.p12`, and `keystore.properties`.

Recreating the keystore on a new machine is just restoring the file. Don't generate a new one.

### How the build finds the key

`src-tauri/gen/android/app/build.gradle.kts` signs the `release` build type from, in order:

1. `src-tauri/gen/android/keystore.properties` (gitignored), for local builds:

   ```properties
   storeFile=C:\\Users\\<you>\\.personal-voice\\signing\\personal-voice-release.jks
   password=<keystore password>
   keyAlias=personal-voice
   ```

   Copy it from `%USERPROFILE%\.personal-voice\signing\keystore.properties`.

2. Environment variables, for CI: `ANDROID_KEYSTORE_PATH`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`. In GitHub Actions, store the `.jks` as a base64 secret, decode it to a temp file at job start, and pass the other two as secrets.

If neither is present, the release APK is built unsigned (`app-universal-release-unsigned.apk`) and won't install.

### Build

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

On a machine where symlinks work, steps 1–3 collapse into `pnpm tauri android build --apk`.

### Install

- **First install on a device:** a debug build (installed from `pnpm tauri android dev` or a debug APK) is signed with a different key. Uninstall it once, then install the release APK. From then on, every release installs over the last.
- **Sideload:** copy the APK to the phone and open it (allow "Install unknown apps" for the file manager once), or `adb install -r release\PersonalVoice-<version>.apk`.
- **Updates keep data:** an update signed with the same key keeps the app's data (sign-in, cached dictionary) and its granted permissions (microphone, display over other apps).

## Checksums

After copying both artifacts into `release/`:

```powershell
Get-FileHash release\PersonalVoice-* -Algorithm SHA256 | ForEach-Object { "$($_.Hash.ToLower())  $(Split-Path $_.Path -Leaf)" } | Set-Content release\SHA256SUMS.txt
```
