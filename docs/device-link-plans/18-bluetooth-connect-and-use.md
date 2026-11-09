# Bluetooth Connect & Use (Android)

## Why
Real Echo Dot testing verified Gemini Assistant PCM playback through an already connected Bluetooth A2DP device, but the user still had to find, pair, and connect it in Android first.

## Implementation
**Devices & Controls → Nearby → Scan → Bluetooth speaker → Connect & Use**, or ask the Assistant to "Find my Echo Dot and Connect & Use it." The existing `list_nearby_devices` and confirmed `control_nearby_device` actions handle the request. There is no new Gemini agent or uncontrolled Bluetooth protocol.

Native discovery retains only a short-lived (~3-minute) private mapping from opaque scanned Bluetooth IDs to radio addresses. Hardware addresses are not exposed to JavaScript or the model. `connect_and_use` requires the exact scanned ID and a device that Android classified as Bluetooth audio. It cannot be invoked for arbitrary addresses or from stale scans.

The native handoff uses `BluetoothDevice.createBond()` for an explicitly selected, observed, unpaired audio device, allowing Android to display its own pairing prompt. For a paired but disconnected device, it opens the standard Bluetooth Settings page so the user can connect/enable **Media audio**. Android does not offer ordinary third-party apps a dependable, public way to force a paired device's A2DP connection, so the action never claims to do that.

For up to two minutes, a bounded Android handler checks A2DP profile connection state using `BluetoothAdapter.getProfileProxy(..., A2DP)` and compares the specific connected device's address against `AudioManager` A2DP outputs. Where Android redacts or replaces an output address, the fallback is allowed only when the target is the *only connected A2DP profile device* and a **single** currently connected A2DP output has no conflicting concrete MAC address. It does not trust a matching device name alone. Ambiguous or unrelated speakers are never selected. Once a match is observed, the existing Assistant PCM media-output implementation is selected without another manual trip to Assistant Settings. If Assistant is live, the native media track reopens and its routed-device ID is checked. If not live, the output is selected for the next conversation. Neither fact proves the speaker was audibly heard.

**Status:** Native `connect_nearby_bluetooth_speaker`, `bluetooth_speaker_status` and `cancel_bluetooth_speaker` commands expose checking, pairing, connect-in-Android, routed/selected, timeout, failure and cancellation states without hardware addresses. Progress appears in Nearby device details and Assistant → Settings → Speech output, and the Assistant can query `device_environment_status`. Cancelling stops this app's monitoring without unpairing or disconnecting the user's Android device. No persistent background monitoring or cloud device list is added.

## Manual hardware acceptance
1. **Previously paired but disconnected Echo Dot:** Open Nearby, scan and tap Connect & Use on the Echo Dot. Android Bluetooth Settings should open with instructions. Connect the **same Echo Dot** and ensure Media audio is on, then return to Personal Voice. Within the bounded attempt, it should say the specific speaker was selected/routed. Speak to the Assistant and **hear** the reply on Echo Dot.
2. **Already connected Echo Dot:** Scan and tap Connect & Use. It should identify the existing A2DP connection, select the speaker without requiring Android Settings (where A2DP already appears in the profile), and confirm native route when a live Assistant track exists.
3. **New unpaired audio speaker:** Scan a powered-on, discoverable Bluetooth speaker identified as audio, tap Connect & Use, approve Android's system pairing prompt, and finish media connection if Android requires. Decline pairing: no output must be falsely reported as connected.
4. **Wrong or ambiguous target:** Keep a second A2DP device nearby or paired, or choose a Bluetooth TV/unknown radio. An unconnected or different speaker must **never** receive a false "selected" result. If Android cannot uniquely identify an A2DP media output, show a clear blocker rather than guessing.
5. **Cancellation and timeout:** Start handoff, do not connect, and cancel. The monitor stops without removing the Android pairing. Start again and leave the target disconnected for two minutes: status should time out and stop checking. Windows and ordinary dictation remain unaffected.

## Validation
CI runs TypeScript and offline tool-use harness evaluations, Windows Rust checks, Android Kotlin compilation and unit tests. Android hardware connection and audible playback require the checks above; CI alone cannot prove them. No system-privileged A2DP connection, hidden API, silent pairing, or confirmation bypass is introduced.
