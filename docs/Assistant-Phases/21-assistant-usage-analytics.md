# Phase A — Assistant Usage Analytics (PR #29)

**Status:** Implemented on branch `feat/assistant-usage-analytics-phase-a`; database migration is **not automatically deployed** by creating a PR. Merge after Windows/Android CI, SQL review and on-device smoke testing.

## Scope and ownership

- **Analytics → Dictation | Assistant** is the current user-facing entry point. The Assistant view measures session starts, finalized user turns by voice/typed/unknown, finalized Assistant replies, bounded active intervals, active days, day trends and per-device turn counts.
- Phase B **Tool Usage & Reliability** and Phase C **Your Assistant Insights** remain intentionally out of scope; system and personal playbooks are unchanged.
- No conversation, message, tool argument, screen/camera payload, audio or sensitive response is written to Analytics.

## Data flow

```
AssistantController finalized user / assistant turn
  → independent setUsageTurnHandler (not the conversation persistence hook)
  → AssistantUsageStore (session identity, user/device/epoch consent, bounded active time)
  → offline queue (localStorage account + epoch; max 500 metadata records)
  → assistantUsageApi (authenticated user-fenced REST/RPC call)
  → write_assistant_usage_event() (atomic owner / usage_intelligence / epoch check)
  → assistant_usage_events (RLS; owner-read only)
  → Analytics > Assistant Overview (merged unique event IDs)
```

The existing dictation `usage_days` store remains the source of dictation counts; the Assistant event stream is separate. The existing development-only trace recorder is not used for production collection.

### Event types

| Kind | Trigger | Counts |
| --- | --- | --- |
| `session_started` | First finalized user turn | One session, never on socket connect |
| `user_turn` | Finalized voice or typed input | One modality-attributed user turn, not speech partials |
| `assistant_turn` | Finalized non-interrupted Assistant response | One response |
| `active_interval` | Bounded user-input and user→Assistant response interaction | Milliseconds measured, capped; split at local midnight |
| `session_ended` | End/error/idle after activity | Reason without conversation text |

**Reconnects are not new sessions.** The existing saved `conversation_id` may span many distinct interaction sessions; no historical durations are backfilled. Inactivity over five minutes causes a new session on the next user interaction. Listening with no finalized activity does not accrue active minutes. Current active-time heuristic counts one second per finalized user input and up to 60 seconds of response work; this is an **estimated engaged interval**, not total microphone-on time or time saved.

### Privacy and reliability

- The account's existing `usageIntelligence` setting gates capture; the backend enforces that setting again when writing.
- Every event has a UUID; re-sent events use `ON CONFLICT DO NOTHING`. User sessions and per-device turns do not duplicate because the controller sees a committed turn only once.
- Backend epoch validation uses the same per-account advisory lock as the existing dictation Analytics write and clear routines. A stale queued event cannot be inserted after clear.
- The existing `clear_usage_analytics()` RPC now deletes Assistant usage events in the same locked transaction as dictation usage.
- Local pending events are removed when account, epoch or consent changes; server ownership is enforced via RLS and a signed-in account check on every HTTP call.
- Offline attempts are held locally and flushed on a later foreground operation. If the app is never reconnected or local storage is cleared, those unsynced events cannot be recovered.
- Windows and Android do not need new permissions for this metadata.

## Deploy order

1. Apply `supabase/migrations/20261009140000_assistant_usage_analytics.sql` in the intended Supabase project using the existing migration deployment workflow. Review owner RLS, RPC grants, the change to `clear_usage_analytics()`, and that `settings.usage_intelligence` is set as expected.
2. Deploy the matching client build after the migration. Before migration, the Assistant view may report an API error and hold limited local metadata for retry.
3. Test an opted-in account on Windows and Android. Verify that the client never stores or uploads message text.
4. Test disabling Usage Intelligence, clearing Analytics, signing out, cross-device viewing and offline retry. Confirm no old-epoch events reappear.

## Automated tests

```bash
pnpm check
pnpm eval:tools
cargo check --locked --manifest-path src-tauri/Cargo.toml
cargo test --locked --manifest-path src-tauri/Cargo.toml
```

`src/usage/assistantUsage.test.ts` covers actual first-interaction session starts, reconnect, duplicate-finalization attempts, typed/voice classification, five-minute idle, per-day midnight splitting, disabled/epoch/account boundaries and summary mathematics.

## Manual smoke tests

1. **Typed interaction:** With Usage Intelligence on, send a typed message and receive a reply. In Analytics → Assistant select 14 days. Expect one session, one typed user turn and an Assistant reply if finalized.
2. **Voice partials:** Start another session, speak an utterance and let Gemini respond. Expect **one** voice turn per finalized utterance, not one per partial transcript. The dashboard should label the voice/typed split correctly.
3. **Reconnect:** During a session, briefly interrupt network then resume. Expect no additional session start; restarting a new interaction after explicit End should count a new session.
4. **Privacy/clear:** Turn off Usage Intelligence; new turns should not increase counts. Re-enable it, clear Analytics and refresh across devices; stale pre-clear events must not be restored.
5. **Cross-midnight/device:** Interact on Windows and Android and inspect the device section; measured activity should show the correct originating device. A midnight-spanning active interval belongs to both local days without an extra session.

## Deferred to other phases

Tool outcome/error/latency and verified task effectiveness → **Phase B**. Conversation-pattern analysis, user adaptation, goals and user-owned Personal Playbooks → **Phase C**. No background semantic analysis, model planning, or change to system playbooks is introduced here.
