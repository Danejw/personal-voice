# Android Spatial Device Scanner (preview)

## Scope
Android Devices & Controls now offers an explicit **Scan nearby** action and a 2.5D room sketch.

Discovery uses Android NSD for named Google Cast, AirPlay, RAOP and Spotify Connect advertisements, targeted SSDP M-SEARCH for UPnP MediaRenderer/DIAL, and a short BLE scan of named advertisements (only when Android Nearby Devices permission has been granted). It also recognizes locally discovered Personal Voice Windows PCs **only when those PCs belong to the signed-in user's existing device list**.

There is no IP range sweep, hidden scan, reverse geolocation, continuous background scan, SSDP LOCATION fetch, cloud-synced room coordinates or auto-inference of exact position.

The map starts empty. The user must select **Place** and tap the approximate location in the sketch. Positions persist locally per Personal Voice install, and remain manual even after rescanning. They are *not* measured distances, directional estimates, camera anchors or a live AR pose. Android CameraX is not used in this PR.

Selecting a discovered service displays its advertised type. No unpaired device is sent a control command. Selecting an existing, nearby paired Windows PC can open the existing Companion flow, which retains all its pairing, authorization and signed-result checks.

## Verification
Run **pnpm check**, **pnpm eval:tools**, Android Kotlin compilation and Windows CI. No new Assistant tool or change to existing Assistant tool semantics was made; the Assistant harness is unchanged.

Physical-device tests required before merge:

1. Android phone + paired Windows PC on the same Wi-Fi: scan returns the PC, select it and open Companion, verify the existing Windows control grant remains mandatory.
2. Google Cast / AirPlay TV or speaker on the same Wi-Fi: discover its advertised name or service if the hardware advertises a supported service, place it and rescan; position stays in the sketch without claiming exact distance.
3. On Android 12+: tap **Enable Bluetooth discovery**, grant permission, rescan near a BLE device advertising its name; verify it appears without MAC address or inferred distance.
4. Disable Wi-Fi, deny local network permission on Android 17, turn off Bluetooth, and scan: errors are visible, app does not crash, and no unrelated services receive commands.
5. Revoke PC pairing or sign out; ensure PC control is unavailable and no device control occurs just from seeing its advertisement.

## Intentional limitations
* BLE scan names only; many devices hide their name. Some TVs require vendor APIs or Cast SDKs and will not appear in these protocols.
* No TV casting, remote controls, arbitrary media playback, AR camera overlay, compass orientation, sensor fusion or automatic room mapping yet.
* No real-world location accuracy is claimed. Live spatial anchors require separate AR permission/session/lifecycle work.
* Native Android discovery and BLE performance must be tested on real hardware before treating this preview as release-ready.
