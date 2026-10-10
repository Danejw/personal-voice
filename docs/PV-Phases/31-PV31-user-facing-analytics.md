# Personal analytics implementation report

Prompt: `prompts/PV-Prompts/Done/31-PV-31 user-facing-analytics-dashboard`

## Scope

A user-facing Analytics page under Settings. Daily counters per device, synced through `usage_days`, replace the undated PV17 totals and the narrower PV15 dictionary store. No correction learning, no LLM profile, no dictionary groups, and no transcript backfill from local history.

## What shipped

- Local days in `usage.days.v1`, with `counters.version` 1. Fields include `outputWords`, `recordingMs`, `completionMs`, `wpmWords`, destinations, the six start triggers, feature counts, hour buckets, and per-term uses.
- Triggers are stamped at the source: `ui-button`, `shortcut-dictate`, `shortcut-note`, `shortcut-handoff`, `overlay`, `android-floating-mic`.
- Word tokens use `Intl.Segmenter` when it exists. Underscore-split pieces stay one token. Dictionary uses count each whole-token appearance, including phrases.
- `recordingMs` is first mic chunk until recording stop. `completionMs` is the existing press-to-delivery time. WPM uses only words that had a measured recording interval. Fastest and slowest require at least 3 seconds and 8 words.
- Sidebar item Analytics. Voice, Devices, and Settings stay mounted. The dashboard loads month, last-14-day, and week ranges, and pages lifetime rows for totals and streaks. This device's local day replaces the matching remote row. A missing device name is **Removed device**.
- Settings keeps the Usage intelligence toggle and Clear analytics. The settings summary points at Analytics. Dictionary rows show uses or Never used.
- An old `usage.totals.v1` blob is labeled "Earlier on this device" and is not copied into today. Clear removes it.
- A successful paste records the receiving application: the Windows process file name or the Android package, plus a short label. The window title is not stored. Notes and Send to device are not pastes. A day keeps 40 named apps and folds the rest into Other. The Analytics page shows that share. Gmail and Docs inside Chrome both count as Chrome.

## Sync

Migration `supabase/migrations/20260928230000_usage_days.sql`.

- `settings.usage_epoch` defaults to 0. A missing settings row is epoch 0. `saveSettings` omits the column. A trigger restores the previous epoch unless `clear_usage_analytics()` set the bypass.
- Authenticated clients may `SELECT` `usage_days`. `INSERT`, `UPDATE`, and `DELETE` are revoked.
- `upsert_usage_day()` and `clear_usage_analytics()` are security definer, lock the same user, and ignore a caller who is not signed in. Upsert updates only when the epoch matches and the incoming revision is greater. Clear inserts a settings row if needed, increments the epoch, and deletes the days in one transaction.
- Bootstrap seeds a missing local day at the remote revision. A higher remote revision replaces a clean local day. A dirty local day is kept. After ack, clean days beyond the newest 90 are pruned locally. Dirty days stay. Other epochs are dropped and are not uploaded.

Migration `usage_days` is applied on project `dlovrtlkniolcovfgvvj`. `src/types/database.ts` matches the generated table and function types and keeps the project's `TableRow` helper.

## Deviations

- PV15 and PV16 were not implemented as their own prompts. Term uses live on the daily counters. There is no correction model.
- Completion time is `totalMs` (speaking, transcription, and delivery), not a new timer.
- The old PV17 event list gained `history_inserted` and `shared_clipboard`. Typed clipboard sends are not a dictation destination.

## Checks

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | PASS |
| Vitest (34 files, 206 tests), including usage segmentation, epoch, bootstrap, prune, paging, and merge | PASS |
| Remote migration `usage_days` on `dlovrtlkniolcovfgvvj` | Applied |

## How to confirm quickly

Sign in, dictate from the button, a Windows shortcut, the overlay, and the Android floating mic, then open Analytics. Words, the trigger, and the device should appear. Turn Usage intelligence off and dictate again; the new utterance should not count. Clear analytics; this device and another signed-in device should drop the old days and start at the new epoch.
