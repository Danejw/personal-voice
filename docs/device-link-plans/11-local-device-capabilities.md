# Verified local-device capabilities (Android)

## Goal

Turn nearby discoveries into useful device-specific actions without guessing authorization, device identity or support. Discovery alone is read-only, and every external action is explicitly tapped.

## Discovery evidence and authorization

- SSDP advertisements carry the response sender's private IPv4. The UI merges sightings only when they share that exact IP; matching names, unresolved DNS-SD services and Bluetooth radios never imply the same device.
- Native Android remembers only recently scanned private IPs, their observed TCP ports and up to four SSDP description URLs. The cache resets on a scan and expires after three minutes. Every action rechecks the current Wi-Fi subnet.
- Inspection reads a bounded UPnP description on the responding sender IP only, with no redirects, off-host URLs, external XML entities or unlimited payloads. Names, manufacturer and model are self-reported, **not** cryptographic proof. The Tizen device-info endpoint is inspected only when port 8001 was reachable in the local scan.
- The native layer determines available capabilities. The frontend accepts only known feature IDs and checks the exact scanned IP. The existing Personal Voice cryptographic pairing gates remain unchanged. A matching IP never grants Companion permissions.
- No Assistant tool, tool schema, or agent permission semantics change in this PR.

## Actions

### Open device page

Available when the LAN scan observed TCP 80, 443 or 8080. Open the exact private IP and observed port in the Android browser. This is **not** proof that the page is an admin interface. No login or credentials are read or stored.

### UPnP media

Available only when the device's description advertises a recognized RenderingControl or AVTransport service, including a same-host control URL. Explicitly tapped Play, Pause and Volume +/- issue fixed UPnP SOAP actions; volume first reads CurrentVolume and adjusts by five. A device can reject a command in its current mode. A successful response confirms only request acceptance, not on-screen effects. Commands remain within the observed private LAN.

### Samsung Tizen remote

Available only when a UPnP description or the Samsung Tizen info endpoint identifies Samsung and the device presents a TLS certificate on local TCP 8002. Inspection first reads only the peer certificate fingerprint. An explicit Pair tap pins it and opens an encrypted WSS session, requiring an on-TV Allow prompt and a successful channel-connected event before remote keys become available. Reconnects use an on-device token and certificate fingerprint. Certificate changes block re-use; Forget clears the local credentials. Only fixed remote keys are permitted. There is no insecure ws://8001 fallback.

Samsung TVs use self-signed TLS certificates; first-contact fingerprint pinning is trust-on-first-use, not third-party identification. The user should confirm the intended TV displays the approval request. Some TVs will not provide this API. Successfully sending a key confirms delivery to the WebSocket, **not** verified TV action.

Bluetooth pairing and ordinary LAN discovery do not authorize remote control.

## Manual physical-device checklist

1. Scan a Samsung TV and check that LAN, MediaRenderer and DIAL sightings with the same observed IP collapse into one entry, without merging unrelated Bluetooth or unknown-IP advertisements.
2. Select a device and inspect its name, model and actions. Public or stale IP targets must be rejected.
3. Open a reachable local web page using the phone browser, without assuming the user has admin permissions.
4. Test actual media play/pause/volume on a renderer offering UPnP services and verify errors are visible when unsupported.
5. On a compatible Samsung TV, pair by approving the TV prompt, then send a remote key and observe the effect. Rejecting the prompt must not enable control. Forget pairing must clear local trust.
6. Disconnect Wi-Fi or change networks and confirm cached device actions are rejected. An unpaired LAN computer must not gain Companion control.

Normal CI covers TypeScript, Vitest, Rust, Android native compilation and Kotlin unit tests. Hardware availability and model support require manual testing.
