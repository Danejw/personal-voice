# PV11 implementation report — device-specific preferences

Prompt: `prompts/PV-Prompts/07-PV11-device-specific-preferences.md`

## Scope

Stop putting machine-specific values on the account `settings` row. Document Account vs Device vs Local machine. Reuse the existing per-account device id. No Windows hotkey on Android.

## What shipped

Local WebView record `device.prefs.<device id>` (`src/settings/deviceSettings.ts`):

| Key | Meaning |
| --- | --- |
| `destination` | Default dictation destination |
| `microphone` | Windows input id (`null` = system default) |
| `showIndicator` | Windows listening pill |
| `pushToTalk` | Windows shortcut list (a legacy install stored one string) |

First bind copies any previous unscoped `settings.*` keys into that record so existing installs keep mic, indicator, hotkey, and destination.

Account row still holds Smart transcription, language, and (later) usage intelligence. Launch at login and Android overlay/accessibility/floating-mic on/off stay OS/local, not this file.

Windows and Android WebView storage are separate, so a Windows hotkey cannot land on a phone.

## Preference scope (as documented)

See the table in `docs/ARCHITECTURE.md` (Preference scope). Overlay layout and auto-start of the floating mic are still not stored.

## Deviations

Android has no microphone picker and no hardware PTT shortcut; those fields exist on the shared record but are unused on Android (floating mic remains the trigger).

## Checks

`src/settings/deviceSettings.test.ts`: bind, legacy migration, per-device isolation. Lint/typecheck/test passed in-session.

## How to confirm quickly

On Windows, change destination, mic, and PTT → they survive restart and sign-out/in on **this PC**. They do not appear on Android. Destination picker after restart still shows the last local choice.
