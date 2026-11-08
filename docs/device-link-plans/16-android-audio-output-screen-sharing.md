# Android Assistant audio output and screen sharing

## Existing source of truth
Personal Voice speaks Gemini Live 24 kHz PCM16 rather than Android TextToSpeech. The Android app already uses `AndroidCommunicationRoute`, an `AudioTrack` with `USAGE_VOICE_COMMUNICATION`, and a MediaProjection one-shot screenshot tool. Bluetooth scanner sightings and bonded devices do not constitute a connected audio sink or a TV screen-stream receiver.

## Assistant audio output
In the Assistant **Settings** tab, **Speech output** lists actual outputs reported by Android `AudioManager.getDevices(GET_DEVICES_OUTPUTS)`. Select a connected Echo Dot, Bluetooth A2DP/BLE speaker or headset. Native Assistant audio switches to a media-usage `AudioTrack` with `setPreferredDevice`. The foreground call route is restored and echo-safe full duplex disabled: the existing Assistant echo gate pauses microphone input while replies play. Changing the output during a conversation clears the current buffered speech rather than pretending it was delivered.

**System default** retains the existing voice-communication/echo-cancelled path at the next session. Changing it during a conversation routes media to the system default until the session is restarted. A saved or merely discovered Bluetooth pairing is never sufficient: connect it as Android media audio first.

## Screen share to a TV
In **Devices & Controls → Settings**, **Start screen sharing** launches the Android MediaProjection consent dialog. Each start requires fresh permission. A visible foreground service captures a bounded preview at up to 4 frames/second and serves an authenticated, temporary MJPEG stream on the phone's private Wi-Fi address. To view it, open the displayed `http://...` URL in a browser on an LG/webOS TV or other compatible device on the same Wi-Fi /24.

The stream never goes to a cloud service. A secure random session token is required; only one simultaneous image-stream viewer is allowed. The local HTTP transport is not encrypted, so the user should use a trusted private Wi-Fi and avoid sharing sensitive content. Android's capture indicator and foreground notification remain present, with a Stop action. End from the Devices page or notification. Content protected against capture can display black. Rotation can require restarting the share. A receiver/browser and same local Wi-Fi are essential; **this is not WebRTC, Chromecast, Roku ECP, DLNA, or Miracast**. It does not automatically control a TV or stream audio.

## Manual hardware acceptance
1. Connect the Echo Dot as a Bluetooth **media audio output** in Android Settings, then open **Assistant → Settings → Speech output → Refresh**. The Echo Dot should appear and be selectable. Start a live Assistant conversation. Speech should come from the Dot; the mic should pause while it replies. Unpair/disconnect the Dot and refresh to verify it is no longer a selectable connected output.
2. During a conversation choose **System default**, then restart Assistant. Verify normal phone/headset voice-call playback and echo-safe behavior return. Select Dot again during a live session, verify queued audio stops and subsequent speech switches to the speaker. Confirm a paired-but-disconnected Bluetooth device is not falsely listed as connected.
3. On the Android phone open **Devices & Controls → Settings → Share phone screen**. Start and approve Android's screen-capture prompt. On LG TV open its web browser, type the displayed local link, and verify the phone display updates. Stop in the app or Android notification; verify the video stops and the old link no longer works. Try denial and verify no server remains. Test a Wi-Fi disconnect and screen orientation change.
4. A Roku without an HTML/MJPEG-capable receiver cannot use this browser link; no Roku screen-cast capability should be claimed. A future WebRTC-specific receiver can be added for compatible TVs if smoother frame rates, audio and encrypted LAN media are needed.

Automated CI validates Kotlin/TypeScript and build; **it does not prove actual Bluetooth routing or TV reception**. Verify these on real devices before cutting a release.
