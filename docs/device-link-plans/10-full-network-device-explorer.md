# LAN and Bluetooth Device Explorer

## What is implemented

Android's user-triggered **Scan nearby** now combines the existing discovery methods with:

- A bounded TCP connect-only scan of the *private IPv4 subnet on the phone's Wi-Fi interface*. A normal /24 checks at most 253 other addresses, using short timeouts and an overall deadline. For larger networks it checks only the /24 containing the phone and labels this limit. No probes leave that private segment and none send application data, fetch service-description URLs or attempt authentication.
- More DNS-SD services for computer/workstation, SMB, SSH, printers and HTTP, alongside existing media services and targeted SSDP queries.
- BLE advertising devices, paired Bluetooth devices and active Bluetooth Classic inquiry. On Android 12+ the user must grant Nearby Devices access for Bluetooth Scan and Connect. The app never initiates pairing or opens a Bluetooth connection.
- One locally held inventory, split into Network and Bluetooth tabs, with sources, detected TCP ports, locally discovered IP addresses, Bluetooth paired status and RSSI when supplied by Android.
- An existing manual 2.5D placement map, now filtered with each tab.

The results describe **detection**, not access. A Bluetooth pair is not a Personal Voice cryptographic pairing or a remote-control grant. Only an authenticated Personal Voice Windows peer can open Companion; all its existing approvals remain in force.

## Accuracy and privacy limits

A phone is not guaranteed to discover all network or Bluetooth devices. Firewalled, sleeping, isolated, nonresponsive or non-discoverable devices can be missing. The LAN scan detects responses on a fixed set of common TCP ports (80, 443, 445, 22, 3389, 8008, 8080, 9100, 554), not all services and not all ports. A router's authenticated DHCP/neighbor inventory would add additional devices, but is not implemented because router vendors require different APIs and credentials. Some BLE advertisements are filtered by Android when the app asserts it does not derive physical location.

No IP range scans on mobile data, public internet or VPN-only networks. No automatic background scanning, credentials, broadcast of results, MAC addresses in the interface, router logins, unexpected TCP application requests or remote actions.

Nearby positions remain **manually marked** and locally stored, not inferred from RSSI or a compass. The app may show multiple records for one physical device when service advertisements cannot be safely matched to its IP address or Bluetooth identity.

## Manual Android acceptance

1. On Android connected to private Wi-Fi, tap Scan nearby; check Network tab lists any responsive devices with IP and TCP services, not just Cast advertisements.
2. On the same Wi-Fi, check the computer, printer and TV visibility; verify the app does not claim that undetected devices are offline or that the inventory is exhaustive.
3. Grant Bluetooth Nearby Devices permission; verify previously bonded accessories, named BLE advertisements and discoverable Classic Bluetooth devices appear in Bluetooth tab.
4. Switch tabs, select a host, and manually place it on the spatial map; rescan and verify the mark persists. A LAN TCP hit must **not** offer Companion unless it has a trusted Personal Voice DeviceLink session.
5. Disable Wi-Fi / deny network permission / revoke Bluetooth permission and rescan. It must fail gracefully. Verify no control command is ever issued to a discovered-only device.

Validation: GitHub Windows lint, typecheck, Vitest, Rust; Android debug APK and Kotlin unit tests. Physical hardware coverage requires manual verification.
