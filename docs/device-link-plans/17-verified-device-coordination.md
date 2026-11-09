# Verified Device Coordination (Android, PR)

## Goal and boundaries
Coordinate an Assistant conversation across existing device output and screen-sharing capabilities without building another agent planner or inventing hardware availability. Reuse the existing Gemini Live tool router, Assistant confirmation UI, AudioManager and MediaProjection implementation. No background scan or persistent environment tracking.

## Evidence, not guesses
- `device_environment_status` is a **fresh read-only** native query of connected AudioManager sinks, the selected media-output preference, observed AudioTrack routed device ID when a native track is active, plus current local screen-sharing browser connection and flushed JPEG frame count.
- A saved Bluetooth bond is **not** a connected A2DP sink. A selected output is **not** proof of audible speech. An Android AudioTrack route observation is better evidence, but only hearing it on the device proves the actual user experience.
- A started MediaProjection service is **not** proof that an LG/Roku TV received anything. `browserConnected` and `framesWritten` indicate that *some* local browser has opened the tokenized link and frames were written to its socket, **not** the viewer's TV identity, rendering or perceived quality.
- The link/token is displayed only on the local Devices Settings page and intentionally omitted from model tool results. Sharing remains HTTP over trusted private Wi-Fi and requires a compatible browser.

## Tool sequence for combined spoken goal
Request: “Play your replies on my Echo Dot and share my phone screen on my LG TV.”

1. `device_environment_status`: verify connected Echo Dot. If it is only paired or missing, ask the user to connect it as an Android media output. Do not guess an ID.
2. `route_assistant_audio`: use the **exact** `audio:N` ID from the live output list, re-read the native route and disclose whether it was observed. The action is reversible and uses the existing echo-gated media playback path.
3. `manage_screen_share` `start`: require explicit Personal Voice confirmation even when auto-run is enabled. Android then requires a fresh MediaProjection consent. Do not start silently or assume the TV is connected. `stop` always terminates the local stream on user request.
4. User opens the temporary URL in the TV browser under Devices & Controls → Settings. `device_environment_status` then reports browser and frame delivery evidence. No app claims the TV visibly rendered the picture without user confirmation.

Other PC actions continue through signed `read_remote_device` / `remote_computer_goal`; account registration is not presence. Never silently substitute another paired PC.

## Permissions and failure safety
- Tauri's existing native plugin allowlist is unchanged. The new Gemini functions use already-granted Android commands and are separately checked for platform and argument validity.
- Screen start is an Assistant confirmation decision, followed by Android OS consent. Cancelling either does not start capture.
- Selecting `audio:N` revalidates the connected output in native Android. Disconnected or fabricated IDs fail. Any native failure becomes a tool error, not a success message.
- Media output has microphone gating during playback, not claimed full-duplex echo cancellation.
- The HTTP share remains foreground, user-visible and stoppable. Stop invalidates the temporary link. No background capture, cloud mirroring, video recording or automatic TV receiver installation.

## Manual acceptance, required before saying the effect works
1. Install new Android build on phone; connect an Echo Dot as **Media audio**. In Assistant Settings, select it. Ask “Which audio output is actually connected?” and then “Route your voice to my Echo Dot.” Confirm it is physically audible and the native route is reported; repeat after disconnecting speaker.
2. Ask “Share my screen with my LG TV.” Verify the Personal Voice approval card **and** Android screen capture consent. Cancel both separately and verify no share is active, then approve and start again.
3. Open link in LG browser. Ask “Is the stream actually connected?” Expect browser-connected true and increasing frames written; unplug Wi-Fi / close browser and confirm status updates. Verify actual visible screen manually. No automatic TV launch is claimed.
4. Ask to stop sharing. Check Android notification disappears and old link no longer works. Ask the Assistant for status again.
5. On Windows, ask for the same Android-only tools. They must reject without changing devices. Regression check Windows Computer Use, screen screenshot, and ordinary dictation.

## Automated validation
Run `pnpm check`, `pnpm eval:tools`, Windows Rust checks, Android compile, Kotlin tests. Offline tool-routing fixtures are **expected paths**, not live Gemini results; real hardware acceptance remains separate.
