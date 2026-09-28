# BUILD ORDER 03 — PV3: Cross-Device Handoff

Inspect the existing `devices` table and sync implementation first.

## Goal
Implement **PV3 — Cross-Device Handoff**.

Allow text or a dictated transcript to be intentionally sent from one owned device to another. Reuse the existing stable device IDs.

Create the smallest synced model required:

```text
handoffs
id
user_id
text
source_device_id
target_device_id nullable
created_at
consumed_at nullable
```

A null target can mean available to all of the user's devices.

Add a new transcript destination: `Send to Device`.

Allow the receiving device to view, copy, insert into active field, and dismiss/consume.

Do not create device-to-device networking, sockets, or messaging/chat. Supabase remains the shared source of truth.

Test Android → Windows and Windows → Android. Preserve existing Notes and Active Field destinations. Run checks and stop.
