# BUILD ORDER 21 — PV28: Windows Mini Command Palette

## Goal
Implement **PV28 — Windows Mini Command Palette**.

Add a global shortcut that opens a tiny lightweight overlay.

Initial choices:

```text
Dictate
Note
Send to Device
Command
Assistant (later, disabled until PV20 exists)
```

Reuse the existing Tauri/Rust global shortcut and window infrastructure.

Do not open the full Settings UI. The palette should disappear after choosing an action or pressing Escape.

Keep it keyboard-friendly and fast. Do not turn it into a general launcher like PowerToys.

Keep platform code inside the existing Windows platform boundary. Stop after PV28.
