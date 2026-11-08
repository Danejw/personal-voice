# Nearby device actions: mobile usability repair

## Problem verified in v0.3.40

The Android Nearby screen renders the entire discovered-device list **before** its selected-device details. With 39 entries in the reported capture, tapping Details selects a device but the capability inspector and actual controls are far below the viewport. The large always-visible room map and flood of anonymous Bluetooth entries make this worse. This is a presentation and navigation defect independent of device protocol support.

## Fix

- Selecting any listed device or placed map marker immediately opens a responsive bottom sheet. It displays the device identity and evidence-backed capabilities and actions without scrolling past the list. Dismiss with the close button, backdrop, or Escape. Keyboard focus is kept inside while open and restored on dismissal.
- Network is the default view after scanning. Search by device name, IP or discovered service. Pairing-capable named devices and authorized Personal Voice peers appear before unidentified advertisements.
- Unknown Bluetooth discoveries are collapsed by default behind an explicit count and can be expanded. Named and already-paired Bluetooth devices remain visible.
- The room sketch is optional behind a Room map toggle. Place/Move actions in the device sheet open the map and select a position. Existing locally saved markers are preserved.
- Device details show native-verified capability names before the action buttons, indicate precisely when remote control is unsupported, and provide Retry identification after failures. Every Bluetooth radio can open Android's real Bluetooth settings for pairing and connection management. No direct Bluetooth control or TV support is fabricated.
- Existing native inspection and control gates remain unchanged. A discovered address or Bluetooth pairing does not authorize Companion or TV commands; Samsung WSS remote still requires verified endpoint, certificate pinning and TV approval.

## Acceptance on Android

1. Scan the network and tap the Samsung-advertised device: its sheet appears immediately, not below 39 results. The device should report any verifiable web, UPnP or secure Samsung remote capability; if not supported, it must clearly say so.
2. Tap the likely router at 192.168.0.1: if TCP 80 was observed, its web page action appears. Open it in the phone browser. A reachable port does not guarantee a working admin page or grant credentials.
3. Bluetooth view shows named and paired radios first. Tap the paired LG webOS TV: Bluetooth management is available through Android settings, while an LG remote is **not** claimed from Bluetooth discovery alone.
4. Expand/hide unnamed Bluetooth devices; use device search and all/network/bluetooth tabs. Scan again, select another device, and confirm the sheet always refers to the current target.
5. Choose Place on map from the sheet; the map expands and accepts a tap. Reopen the device and check Move/Remove placement and persistence after another scan.
6. Verify Cancel/close/backdrop/Escape and keyboard focus work, including on small phones, with the floating assistant controls visible in the app.
7. Confirm authenticated Personal Voice PCs still launch Companion only with signed DeviceLink authorization.

Verification requires GitHub Windows typecheck/lint/Vitest/Rust and Android APK/Kotlin checks. Physical device interactions are not proven by CI.
