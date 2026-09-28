# Testing and Releases

## Testing philosophy

Most automated tests should target shared logic.

Native integration requires real-device smoke testing.

## Automated test targets

Test at minimum:

- state transitions
- duplicate partial/final transcript handling
- final transcript only inserts once
- empty transcript behavior
- provider disconnect behavior
- token expiration behavior
- dictionary serialization
- settings persistence
- settings sync
- cancellation
- retry/recovery logic

## Windows release smoke test

Before shipping a personal release:

```text
[ ] launch app
[ ] login/token acquisition succeeds
[ ] microphone works
[ ] hotkey starts exactly one utterance
[ ] release finalizes
[ ] transcript inserts into Notepad
[ ] transcript inserts into browser textarea
[ ] transcript inserts into Cursor/VS Code
[ ] clipboard behavior is acceptable
[ ] network disconnect is handled
[ ] app restarts cleanly
[ ] tray quit actually exits
```

## Android release smoke test

```text
[ ] install signed APK over previous version
[ ] login/token acquisition succeeds
[ ] microphone permission works
[ ] overlay permission path works
[ ] accessibility setup path works
[ ] overlay starts one utterance
[ ] release finalizes
[ ] text inserts into supported external apps
[ ] foreground-service notification behaves correctly
[ ] network disconnect is handled
[ ] app survives normal background/foreground transitions
```

## Versioning

Use SemVer while pre-1.0:

```text
0.1.0
0.2.0
0.3.0
```

The version lives in `package.json` (and must match `src-tauri/Cargo.toml`). Build steps and the Android signing key are in `docs/RELEASING.md`.

## GitHub Actions

A tagged release should eventually build:

```text
Windows installer
Android signed artifact where secure signing setup permits
checksums
release notes
```

Do not put signing secrets in the repository.

## Windows updates

Use Tauri's supported desktop update mechanism once packaging is stable.

As implemented (Phase 8): `tauri-plugin-updater` with `latest.json` from GitHub Releases, signed by the updater key in CI. See `docs/RELEASING.md`.

```text
[ ] Updates section shows the installed version
[ ] a newer published release shows "Version X is available" with its notes
[ ] Install and restart is disabled while dictating
[ ] Install and restart: the app closes, the installer runs, and the new version reopens
[ ] sign-in, dictionary, and settings are still there
```

## Android updates

For personal sideloading, V1 may simply:

1. check a release endpoint for a newer version
2. notify the user
3. open/download the signed APK
4. let Android perform the package update

Do not build a custom silent updater.

As implemented (Phase 8): the latest-release API on GitHub, then the browser download, then Android's package installer.

```text
[ ] a newer published release shows "Version X is available"
[ ] Download update opens the APK download in the browser
[ ] opening the download shows Android's update screen, and it installs
    (Play Protect may block it first: More details, then Install anyway)
[ ] the app reopens on the new version with sign-in, dictionary, and permissions intact
```

## Release rule

Never ship a release that cannot install over the previous version while preserving user data/settings unless the migration is intentional and documented.
