# Action-first nearby devices and compact device tabs

## Scope

Devices & Controls is organized into **My devices**, **Nearby**, and **Settings**. The three tabs share one page and preserve the active nearby scan while switching tabs. My devices displays registered Personal Voice installs and puts QR/code pairing and rename/remove behind a disclosure. Settings retains the existing Windows keybindings and Android floating-mic controls. Nearby has a compact scan button, Wi-Fi/Bluetooth filter, search, action-first rows, and paginated results. The manually placed room map and network scan details are available under an optional disclosure instead of occupying the screen.

## Discovery fixes

The explicit Android LAN scan now includes TCP **8060**, so Roku's advertised control service can be observed. SSDP also probes **roku:ecp**. The one-shot DNS-SD scanner now *resolves discovered services to their local IPv4 address and port* with a short timeout and strict work limit, using Android's NsdManager. An unresolved service stays visible but remains unaddressable. The TS inventory groups only records with the exact same observed private IP, so a printer advertising HTTP/IPP/Printer services can appear as one device rather than three. Bluetooth radio observations never get guessed IPs.

A DNS-SD-advertised port is **not** treated as proven reachable: native LocalDeviceCapabilities only counts connect-tested LAN ports for website/control promotion. It still independently checks recent scan evidence, current Wi-Fi subnet, protocol, TV certificate and pairing before executing local actions. Native discovery does not send any Roku ECP commands.

## Roku restriction and safe handoff

Roku's current External Control Protocol guidance explicitly states that ECP commands may not be sent from third-party mobile platforms. Instead of bypassing this restriction, a verified Roku SSDP advertisement or observed port-8060 host offers **Open official Roku remote**. This opens the installed Roku Android app (com.roku.remote) if present, or its official Google Play listing. It sends no third-party ECP keypresses and does not infer that the TV is actually controllable by Personal Voice. Reference: https://developer.roku.com/dev/docs/external-control-api

Other verified protocol adapters remain available through the same unified registry: TV-approved LG webOS / Samsung, UPnP playback or volume, reachable local web pages, Android Bluetooth settings, and signed Personal Voice PC Companion.

## UI and verification

Device rows are sorted with paired/known hosts first, show a readiness explanation from validated identity, and expose a small quick action only if a supported action was verified. More controls open in the existing focus-managed device bottom sheet. Capabilities are informational and collapsed after the controls. No guessed capability or remote effect is displayed as confirmed.

### Manual smoke checks (Android release/PR preview, not a browser-only mock)

1. Open **Devices & Controls**. Switch among **My devices**, **Nearby**, and **Settings**. Check that pairing, network scanning, and floating-mic settings are in separate tabs and that a scan stays visible when switching tabs.
2. In **Nearby**, scan the same Wi-Fi as a Roku and HP printer. Confirm Roku is identified from 8060/SSDP as available, and resolved HTTP/IPP/Printer advertisements group under one printer IP where Android DNS-SD resolution succeeds. Unresolved entries must clearly show that their network address is missing. Tap the Roku companion action and verify it opens the official Roku app or store page, **not an unapproved direct ECP remote**.
3. On a verified TV or UPnP speaker, tap its action chip. Check that a genuine volume/play/pair action works, that pairing waits for on-TV approval, and that unsupported Bluetooth items only offer Android Bluetooth settings. Verify an AI device-control request still requires explicit Personal Voice confirmation.

CI: Windows pnpm check, pnpm eval:tools, Rust tests, Android Kotlin compile and unit tests. CI does not verify live home-network behavior. The source code and native evidence rules remain authoritative.
