# PV4 implementation report — shared clipboard / send to device

Prompt: `prompts/PV-Prompts/04-PV4-shared-clipboard-send-to-device.md`

## Scope

Send arbitrary text to another device even when it did not come from dictation. Reuse PV3 handoffs. Do not monitor or continuously sync the OS clipboard.

## What shipped

- No new table. Typed/pasted compose in **Send to device** calls the same `HandoffStore.send()`.
- The same `DeviceTargetField` is used for Voice handoff (dictation destination) and Shared clipboard (manual send).
- Receive actions stay Copy, Insert, Dismiss.
- Reloads replace the snapshot rather than appending. Two explicit sends with the same text are two rows.

UI copy distinguishes Voice handoff (destination) from Shared clipboard (compose box) while sharing one backend representation.

## Deviations

The prompt’s examples (“Copy text on Windows → Send to Galaxy”) are done by paste/type into Settings, not by reading the OS clipboard. That matches “do not silently synchronize the OS clipboard.”

## Checks

Handoff store tests already assert that a refresh does not duplicate rows and that each send creates a row. No OS clipboard APIs were added.

## How to confirm quickly

Paste or type into the Send to device compose box → Send → other device shows it. Send the same text again; two pending rows. Reload Settings; still two, not four.
