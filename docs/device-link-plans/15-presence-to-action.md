# Presence-to-Action: live discovery, verified controls, assistant execution

## Live evidence
A saved Android Bluetooth bond is a remembered device, not evidence that its radio is currently observable. Android Classic inquiry and BLE advertisements set `observedNow=true`; enumerated bonded devices set `observedNow=false`. If the same hardware identity appears in both sources, the live observation wins while the stored `paired` flag is preserved. Network packets and authenticated Personal Voice peers are live observations, but neither automatically grants device control.

The Nearby page preserves the existing Network/Bluetooth/All filters and now summarizes **observed** versus **saved pairings**. Saved Bluetooth entries are explicitly labeled, and observed Bluetooth entries can open Android Bluetooth settings. An advertisement or a stored bond is not a verified control channel.

## Action truth
Native LG webOS and Samsung TV sessions now expose distinct `paired` and `connected` facts. Saved authorization can survive a restart while the WebSocket is gone. The UI offers **Connect** instead of dead remote keys, and control actions are advertised only after an active authenticated TV session is established. The existing TLS certificate pinning, explicit on-TV approval, local-subnet checks and native action allowlists remain unchanged. Native execution still independently refuses stale sessions.

## Assistant
Existing `list_nearby_devices` accepts an optional `query` string. For requests like "find my LG TV", a fresh local scan filters and inspects matching entries instead of returning only the first 28 unrelated entries. Its response includes observed-versus-saved evidence, TV session readiness, exact scanned IDs and allowlisted actions. The assistant must use `control_nearby_device` with that exact ID; the existing explicit confirmation flow and native protocol validation remain mandatory even in auto-run. The assistant does not invent IP addresses or imply a physical effect merely from an action receipt.

## Test
- Android: Previously bonded Bluetooth devices show **Saved pairing** until their radios are observed. Live BLE/Classic devices show **Detected**. Opening a live Bluetooth device offers Android **Settings**, not unsupported direct controls.
- Network: Scan, open verified Roku/HP endpoints, and confirm unsupported services remain informational. The existing PR #82 printer endpoint checks are preserved.
- TV: A previously approved but disconnected LG/Samsung TV shows **Connect**. Confirm pairing on the TV if needed, then check volume/pause through the UI; re-scan after restarting to confirm no stale "Controls ready" state.
- Assistant: Ask "Which LG TVs are visible and can you control one?" and then "Turn the LG TV volume up." It must search by name, identify a verified network target, request explicit in-app confirmation and return the actual native action result. A Bluetooth-only LG pairing must **not** be treated as Wi-Fi control.
- Regression: Windows pnpm check/tool harness and Android compile/Kotlin tests must pass. Real-hardware action effects need observation; no simulated success is claimed.

No continuous background scanning, cloud upload of local inventory, arbitrary IP access, or automatic physical action execution.
