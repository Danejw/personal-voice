# BUILD ORDER 04 — PV4: Shared Clipboard / Send to Device

Build on PV3 rather than creating another synchronization system.

## Goal
Implement **PV4 — Shared Clipboard / Send to Device**.

Allow arbitrary text to be sent to another device even when it did not originate from dictation.

Examples:

```text
Copy text on Windows → Send to Galaxy
Select text → Send to Desktop
```

For now, the user may explicitly paste/type text into the Personal Voice UI to send it.

Reuse the Handoff infrastructure where possible. Do not silently synchronize the OS clipboard continuously and do not monitor clipboard changes in the background.

The receiving device should expose Copy, Insert, and Dismiss.

Keep Voice Handoff and Shared Clipboard understandable in the UI even if they share the same backend representation.

Test cross-device delivery and duplicate handling. Stop after this functionality works.
