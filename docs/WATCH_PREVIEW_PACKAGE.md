# Watch preview Android package identity

PR watch-testing builds use the Tauri config override `src-tauri/tauri.watchpreview.conf.json` and `bundle.android.debugApplicationIdSuffix=".watchpreview"`. This forces `com.personal.voiceapp.watchpreview` for Android debug preview builds.

The earlier debug APK (November 19, 2026, original tag `watch-preview-20261119`) unintentionally retained `com.personal.voiceapp` despite a Gradle-only `applicationIdSuffix=".preview"`. It used the runner debug signing key, so Android rejected installation over the stable, differently signed app. It was **not safe to recommend uninstalling stable Personal Voice**.

The official Tauri config property controls how the CLI injects the debug suffix at build time. The Android Validate workflow now checks the compiled APK's actual `aapt dump badging` package ID and fails if the suffix is missing or incorrect. The workflow additionally validates the APK signature and zip alignment before publishing an artifact.

The separate watch preview package has independent app data and login. The stable `com.personal.voiceapp` application and its update channel remain unchanged. This configuration is passed via `--config` only for the PR debug build; regular stable release builds do not use this override.

To verify: build using the exact Android Validate command, inspect `aapt dump badging`, and confirm `com.personal.voiceapp.watchpreview`. Install the verified preview APK on the phone alongside the stable app, then follow [WATCH_INTEGRATION.md](WATCH_INTEGRATION.md).
