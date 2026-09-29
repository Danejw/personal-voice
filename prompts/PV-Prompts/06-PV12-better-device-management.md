# BUILD ORDER 06 — PV12: Better Device Management

The repo already has device records. Do not replace them.

## Goal
Implement **PV12 — Better Device Management**.

Add a simple Devices UI based on the existing `devices` table.

Show friendly device name, platform, last seen, and current device indicator.

Allow renaming a device and removing an old device. Users should be able to rename defaults like Windows/Android to `Desktop`, `Laptop`, or `Galaxy`.

Do not add remote management or remote commands.

Deleting the current device should either be prevented or handled safely. Removing a device must not corrupt existing notes/handoffs referencing it.

Run RLS and sync tests. Stop after PV12.
