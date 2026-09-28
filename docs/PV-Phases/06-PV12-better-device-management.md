# PV12 implementation report — better device management

Prompt: `prompts/PV-Prompts/06-PV12-better-device-management.md`

## Scope

A Devices UI on the existing `devices` table. Rename and remove. No remote commands. Removing a device must not cascade into notes or handoffs.

## What shipped

- `DeviceStore` / `DevicesPanel`: every owned install, friendly name, platform, last seen, **This device**.
- Rename writes only `name` (1–100 characters after trim). `touchDevice` still refreshes `last_seen` without overwriting a custom name.
- Remove deletes the `devices` row and is **refused for the current install**.
- Notes and handoffs still have no foreign keys to `devices`, so deleting an old install leaves those rows intact.

## Deviations

None relative to the prompt. Remote wipe/lock was not added.

## Checks

`src/devices/DeviceStore.test.ts`: list, rename, refuse remove of this device, remove of another. Existing RLS on `devices` is unchanged.

## How to confirm quickly

**Devices** shows this install as This device → rename to something like Desktop → reload; name sticks. Remove on This device is blocked. With a second registered install, Remove on the old one succeeds; notes/handoffs from that id still load.
