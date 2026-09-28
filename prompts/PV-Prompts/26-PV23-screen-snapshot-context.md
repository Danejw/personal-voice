# BUILD ORDER 26 — PV23: Screen Snapshot Context

Assistant Mode now has structured context.

## Goal
Implement **PV23 — Screen Snapshot Context**.

Allow the user to deliberately capture the active window or current screen and attach the image to Assistant Mode.

Privacy requirements:
- explicit user action
- visible preview
- ability to remove before sending
- no background continuous capture
- no unnecessary permanent screenshot storage

### Windows
Use a reliable native/Tauri screen/window capture path.

### Android
Use the current Android-supported MediaProjection flow. Do not use AccessibilityService as a screenshot mechanism.

Verify the current Gemini Live image-input format and send the screenshot directly when supported.

Do not add OCR unless technically necessary.

Stop after PV23.
