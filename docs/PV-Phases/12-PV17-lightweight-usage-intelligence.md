# PV17 implementation report — lightweight usage intelligence

Prompt: `prompts/PV-Prompts/Done/12-PV17-lightweight-usage-intelligence.md`

## Scope

Private operational counters for improving this app. No transcript text, no microphone audio, no third-party analytics. One setting to disable. Telemetry failure must never break dictation. Prompts 10 (PV14) and 11 (PV7) were skipped; this phase still ran. Stopped before PV19 latency dashboard.

## Event schema

Documented in `docs/ARCHITECTURE.md` and `src/usage/usageEvents.ts`. Each event is stamped with the local `platform`. Extra fields never include text or PCM.

| Event | When | Extra |
| --- | --- | --- |
| `dictation_started` | New utterance (utterance counter advances) | |
| `dictation_completed` | Destination delivery succeeded | `durationMs` (press → delivered) |
| `dictation_failed` | Lifecycle entered `ERROR` | |
| `recovery_used` | Replay-from-buffer produced the delivered transcript | |
| `destination_used` | Selected destination accepted the transcript | `destination` |
| `voice_note_created` | Voice note row saved | |
| `handoff_created` | Handoff row saved (dictation or typed send) | |
| `selection_captured` | Selection capture succeeded | |

Events fold immediately into local aggregates (`usage.totals.v1`). There is no event log and no per-event sync. Accidental tap/cancel can count as started without completed or failed.

## What shipped

- `UsageStore`: increment-only totals; `record` / `recordLater` never throw to callers; disable drops new events and keeps existing totals.
- Account **Usage intelligence** toggle (`settings.usage_intelligence`, default true) plus a one-line this-device summary.
- Counters are **not** synced (last-write-wins on `settings` would clobber the other device). Only the opt-out syncs.

Migration `supabase/migrations/20260928160000_usage_intelligence.sql`, applied on `dlovrtlkniolcovfgvvj`.

## Deviations

- `duration` is a field on `dictation_completed` (`totalMs` on utterance timings), not its own event name.
- `recovery_used` fires on **successful** recovered delivery, not on a recovery attempt that then fails.
- No reliability dashboard (that is PV18).

## Checks

| Check | Result |
| --- | --- |
| `eslint src`, typecheck, Vitest | PASS, 25 files / 154 tests (includes usage apply/parse/disable/no-throw) |
| Supabase migration | Applied |

## How to confirm quickly

Dictate, save a note, send a handoff, capture a selection → Account counts rise. Turn Usage intelligence off → further dictation does not increase counts. Toggle on another signed-in device; counts stay per device.
