# Phase 7 — Packaging

Read:

- `AGENTS.md`
- `docs/TESTING_RELEASES.md`

## Goal

Produce installable personal builds for Windows and Android.

## Windows

Create a normal signed-ready Tauri installer configuration.

Preferred initial artifact:

```text
VoiceApp-Setup.exe
```

Use the appropriate Tauri Windows bundler/NSIS path.

Actual commercial code signing is optional for the first personal build, but configuration must not make later signing difficult.

## Android

Produce a release APK suitable for sideloading on controlled devices.

Use one permanent Android signing identity.

Never commit the private signing key.

Document how to back it up and configure CI/local builds.

## Versioning

Use a single application version across platforms.

## Acceptance criteria

- Windows installer installs and launches cleanly
- upgrading/reinstalling does not unexpectedly lose app data
- signed Android APK installs on target device
- a new APK signed with the same key can update the prior version
- build commands are documented

Do not build update checking yet.

Stop after packaging.
