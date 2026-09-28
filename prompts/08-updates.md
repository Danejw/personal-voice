# Phase 8 — Releases and Updates

Read:

- `AGENTS.md`
- `docs/TESTING_RELEASES.md`

## Goal

Make maintenance easy across Windows and Android.

## GitHub Actions

Create a release workflow triggered by version tags.

A release should produce the appropriate artifacts for:

- Windows
- Android

Keep signing secrets in CI secret storage only.

## Windows

Use the current officially supported Tauri desktop updater mechanism.

Implement:

- update check
- clear user prompt
- authenticated/signed update verification as required by Tauri
- safe restart/install flow

## Android

Do not assume Tauri desktop updater supports mobile.

For personal sideloaded Android distribution, implement only a simple update notification flow:

```text
check release metadata
→ newer version exists
→ show update available
→ open/download signed APK
→ Android package installer handles update
```

Do not attempt silent installation.

If current Android security rules require different UX, follow current platform rules.

## Acceptance criteria

A tagged GitHub release can generate both platform artifacts.

Windows can update using the supported Tauri path.

Android can detect a new release and guide the user to install the correctly signed APK.

Stop after Phase 8.
