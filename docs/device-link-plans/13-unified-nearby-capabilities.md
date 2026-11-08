# Unified Android nearby capabilities and Assistant access

## Goal and source of truth

The same current native Android discovery and local protocol permissions power both the Nearby device screen and Gemini Live Assistant. A device can be found without granting it control privileges.

Data flow:

1. Explicit user request or Scan button invokes one shared ephemeral scanner.
2. LAN/SSDP and Bluetooth sightings are normalized using source evidence, not names; no inferred Bluetooth-IP joins. Current account-owned, signed Personal Voice peers are distinguished from generic LAN devices.
3. The bounded native inspector checks devices on the scanned private Wi-Fi subnet, identifies only actual local protocols, and returns capabilities and separate pairing state.
4. A compact allowlist maps the normalized action (volume_up, play, pause, pair, and so on) into one specific native protocol. Neither UI nor Live model may supply an arbitrary endpoint or raw device command.
5. For voice, the model first calls list_nearby_devices (read-only). It receives exact scanned IDs, native-verified actions, protocol, and authorization state. The user may then request control_nearby_device with an exact returned ID and a supported action. Personal Voice always displays an approval card before executing any physical control, even when Assistant auto-run is enabled. The TV must also approve its own pairing request.

Android app only. Windows local tools remain as-is. The existing signed remote_action and remote_computer_goal tools control paired Windows PCs; the generic nearby protocol never replaces their authentication.

## Bounded local observation

The shared inventory is **in app memory only**, expires after three minutes and is reset by every new scan. **Privacy:** On an explicit Assistant scan request, the bounded list of observed device names, local IP addresses, capabilities and authorization labels is sent as a Gemini Live tool response to answer the user. The tool result does not include MAC addresses, TV credentials, certificate fingerprints or pairing keys. No device scan is automatically persisted by the app. It inspects at most nine addressed devices per tool response, in batches of three, and returns at most 28 identified entries with counts for suppressed unnamed Bluetooth advertisements. All uninspected entries say not_inspected; no inferred capability is shown for them. An exact ID from the latest scan is required for execution; re-inspection may run on an uninspected selected device. The native layer independently rechecks Wi-Fi subnet, private target address, expiry, protocol evidence, TLS certificate pin, TV approval and strict supported-command lists.

LG webOS: same-subnet Wi-Fi host with an LG SSDP response or validated WSS 3001 hello is eligible for a PINNED, explicitly approved LG TV registration. On-device key persists privately. A command must produce a webOS SSAP success response; visible effects remain unverified without actual TV observation. Samsung remote uses the existing pinned WSS 8002 channel and TV approval. UPnP only exposes advertised playback/volume services and routes through existing native SOAP validation. A reachable web port only opens the Android browser, not a privileged administrative session. Bluetooth device records can open Android Bluetooth settings but cannot be treated as third-party remotes.

## Example live interactions

- "What devices are nearby and what can you actually do with them?" should call list_nearby_devices and answer only from a fresh result with verified or unavailable action labels.
- "Pair the LG TV you found" should identify its exact scanned ID, ask for Assistant approval, request pairing in the TV's local UI, and report denial/timeout rather than implying pairing succeeded.
- "Turn the LG TV volume up" should first verify it was found and paired, then display a confirmation card for a single volume action, execute through native SSAP and report only the protocol receipt. The TV's audible volume still needs physical validation.
- "Open Calculator on my paired desktop" should use existing signed remote_action, not generic nearby control.
- An ambiguous target, unsupported action, stale scan, public IP, unverified TV certificate or unpaired remote must not result in a device action.

## Checks and manual acceptance

Run pnpm check, pnpm eval:tools, and GitHub Windows and Android Validate jobs. Automated tests should cover catalog/router/intelligence/fixture parity, malformed IDs/actions, Android-only tools, confirmation even with auto-run on, cancellation without side effects, native allowlists, and the local service refusing unsupported devices. Run a manual Android voice and typed Assistant test against at least one TV with the on-TV approval prompt. Device and command receipts do not establish a verified physical outcome.
