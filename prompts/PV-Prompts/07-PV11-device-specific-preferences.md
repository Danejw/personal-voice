# BUILD ORDER 07 — PV11: Device-Specific Preferences

Build on PV12.

## Goal
Implement **PV11 — Device-Specific Preferences**.

Separate account-wide settings from settings that belong to one device.

Examples:

```text
Windows hotkey
preferred microphone
default dictation destination
Android floating mic preference
future overlay preferences
```

Do not automatically sync Windows-specific settings to Android.

Explicitly decide and document which settings belong to `Account`, `Device`, or `Local machine only`.

Reuse the existing device ID. Keep the schema small and implement only settings the current app can actually use today.

Preserve current behavior and migrations. Stop after PV11.
