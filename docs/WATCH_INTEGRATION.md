# Universal Device Platform watch integration

The shared reference is [Danejw/universal-device-platform](https://github.com/Danejw/universal-device-platform/tree/main/protocol). This application consumes the versioned `udp/1` protocol through a virtual watch and a native Android BLE test adapter.

## Where to test

The Pull Request Android debug build sets `VITE_ENABLE_UDP_SIMULATOR=1`. The virtual-watch control is under **Devices > Nearby** on Android. A virtual watch is a simulated input device, with no actual camera, microphone, heart-rate, or battery readings.

The APK has a separate `.preview` application ID so it can coexist with the existing release app. No additional repo, secret, cloud service, or wearable is required.

## Manual Android test

1. Open the PR's latest **Validate** workflow. Confirm Windows and Android pass.
2. Download the `personal-voice-spatial-preview` APK artifact, and install it on your phone. GitHub may require signing in.
3. Sign in to Personal Voice and allow microphone access.
4. Open **Devices > Nearby > Virtual AI Watch**. Tap **Connect virtual watch**.
5. Tap **Tap watch button**. Speak a request into the phone's microphone. Confirm a real Gemini Live response is audible.
6. Tap the simulated button again to end the assistant, then **Disconnect**.
7. Confirm that Companion hold-to-talk, dictation, and paired Windows DeviceLink still work.

## Physical BLE bench path

The XIAO ESP32S3 Sense reference firmware advertises the BLE name `UDP-W0` and V0 service. After a user-triggered Nearby scan, select the observed watch and tap Connect watch. The native Kotlin adapter looks up the short-lived opaque scan ID, connects to that specific radio, verifies the GATT service, short manifest, and notifications, and forwards a `P` notification as `button.primary.pressed`.

**Security restriction:** Physical BLE access is debug-build only. The current board firmware does not provide authenticated application-level pairing. It can be tested for explicit user-selected button input, but must not be shipped for private media, unattended device actions, or trusted health measurements. Pairing, authorization, and anti-replay are future gates.

## Evidence and limits

Passing CI proves code compilation and contract tests. It does **not** prove an ESP32 connected or that real Gemini audio played through the phone. Real camera/audio/sensor drivers, battery integration, and the secure physical connection are outside this software-only milestone.

The watch firmware currently reports a press but not a release, so the first interaction uses **tap-to-toggle** the existing Assistant. The existing Companion hold-to-talk input remains unchanged.

The integration is built as separately revertible commits in the PR. Roll back by reverting the phase commit or removing the debug watch adapter; existing device and assistant paths should remain intact.
