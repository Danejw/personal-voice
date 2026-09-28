# BUILD ORDER 20 — PV27: Android Quick Settings Tile

The Android app already has a floating microphone and foreground service.

## Goal
Implement **PV27 — Android Quick Settings Tile**.

Add an Android Quick Settings tile for fast access to Personal Voice.

Use it for an action that is reliable under current Android restrictions, such as turning the floating mic on/off or launching the app into the appropriate voice state.

Do not bypass Android foreground-service or microphone restrictions.

Reuse the existing Android service/plugin implementation. Do not create another Android application/service architecture.

Ensure the tile accurately reflects floating microphone state.

Test on a real Samsung device where possible. Stop after PV27.
