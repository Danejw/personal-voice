# PV3 implementation report — cross-device handoff

Prompt: `prompts/PV-Prompts/03-PV3-cross-device-handoff.md`

## Scope

Intentionally send a dictated transcript (later also typed text, PV4) from one owned device to another through Supabase. No device-to-device sockets or chat.

## Database

Migration `supabase/migrations/20260928135000_handoffs.sql`:

| Column | Role |
| --- | --- |
| `id` | Primary key |
| `user_id` | Owner; RLS |
| `text` | Payload |
| `source_device_id` | Sender; no FK |
| `target_device_id` | Nullable: one device, or all other devices when null |
| `created_at` | Sent time |
| `consumed_at` | Null until Dismiss |

The receiver query excludes the source device and returns pending rows targeted at this device or at all devices.

## What shipped

- Destination `send-to-device` via `HandoffStore.send()`.
- **Voice handoff target** picker (`DeviceTargetField`): a specific other device, or all others when none is selected.
- Receive list: Copy, Insert, Dismiss. Copy/Insert do not consume; Dismiss sets `consumed_at`.
- `PlatformAdapter.insertReceivedText()`: Windows hides Settings (~150 ms) then pastes; Android `moveTaskToBack` then accessibility insert.

Handoffs refresh on sign-in, focus, visibility, or explicit reload. No polling and no realtime channel.

## Deviations

Insert of a received handoff uses the same native insert path as dictation, after hiding Settings so the previous app is focused. That hide-then-insert step is extra platform work the prompt implied by “insert into active field.”

## Checks

`src/handoffs/HandoffStore.test.ts` covers send, receive filtering, and consume. Lint/typecheck/test passed in-session. Android ↔ Windows end-to-end remains a manual two-device smoke.

## How to confirm quickly

Two signed-in devices. On A: destination **Send to device**, pick B, dictate. On B: open Settings (or refocus it) → **Send to device** list → Copy / Insert into another app / Dismiss. A must not see its own send in the inbox.
