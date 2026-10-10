# Phase B — Assistant Tool Usage & Reliability Analytics (PR #30)

**Status:** Implemented on a stacked feature branch based on PR #29. PR #29 remains open; no migration is applied by committing this PR.

## Boundaries

- **Analytics** owns measurable tool usage, outcome reliability, failure categories and elapsed time.
- **Insights** continues to own user understanding, preferences, recurring workflows and proposed personal playbooks (Phase C, not implemented here).
- System playbooks remain versioned, developer-owned reference guidance; they do not execute actions.
- No new Assistant/Gemini Live tool declarations, permissions, auto-run changes or autonomous execution are introduced.

## Data flow

```
Gemini Live toolCalls event (call ID + declared name, no arguments)
  -> AssistantController.setToolMetricsHandler: calls
  -> AssistantToolMetricsStore.noteCalls: in-memory call-ID map and start time
  -> existing decideToolCall / AssistantController executor and confirmation
  -> interpretToolResult (PR #24), classified status and failure type
  -> AssistantController.setToolMetricsHandler: result, no raw response string
  -> AssistantToolMetricsStore.noteResult: duration + normalized outcome
  -> bounded account/device/epoch-scoped local metadata queue
  -> write_assistant_tool_attempt (authenticated/RLS/consent/epoch validation)
  -> assistant_tool_attempts
  -> Analytics > Assistant > Tools & Reliability
```

The PR #26 **development-only evaluation trace recorder** stays separate. Its `goal_verified` values cannot be inferred from a production tool acknowledgement. No raw prompts, arguments, tool outputs, screen/camera captures or provider tokens are sent to Analytics.

## Event contract

The stored event is an independently generated UUID, timestamp, local day, device ID, usage epoch, exact allowlisted tool name (or `unknown_tool`), declared tool family, outcome, normalized failure type, and elapsed milliseconds. There are no persisted Gemini call IDs.

| Outcome | Interpretation |
| --- | --- |
| `observed` | A read/capture tool returned information. This does **not** independently prove the user's overall goal. |
| `acknowledged` | An action was accepted by an executor; postcondition may be unverified. |
| `failed` | The action/validation returned an error. |
| `blocked` | Action could not proceed (busy/unavailable/unsupported). |
| `incomplete` | Explicit partial tool result or an in-flight call was abandoned on session end. |
| `cancelled` | User declined/cancelled. Distinct from a failure. |
| `reference` | Loaded a system playbook; no user action was executed. |

`accepted response rate = (observed + acknowledged) / (observed + acknowledged + failed + blocked + incomplete)`. `cancelled` and `reference` are excluded from the denominator. This is **not** task completion rate.

**Latency:** measured wall-clock time from the Live call event until the interpreted reply; includes time waiting for user confirmation. UI displays nearest-rank median and P95. Not raw execution time or provider latency.

**Follow-ups:** if a device calls the same tool again within two minutes after a failed or blocked attempt, it counts as a *post-failure same-tool follow-up*. A later `observed`/`acknowledged` response is counted separately. This is a **heuristic**, not a proven retried task or successful recovery.

**Goal completion:** `goal_verified` is NULL for all production tool events. Independent success verification would require a separate trustworthy observation mechanism; it is not implemented in Phase B. Do not display a fabricated completion percentage.

## Data ownership and deletion

- `supabase/migrations/20261009150000_assistant_tool_reliability.sql` creates `assistant_tool_attempts`, strict owner-read RLS and `write_assistant_tool_attempt` RPC. It requires the Phase A migration.
- Direct writes are revoked. The authenticated RPC checks `auth.uid()`, the account's `usage_intelligence` flag and `usage_epoch`, holding the same advisory lock as Phase A clear.
- The existing `clear_usage_analytics()` is replaced to remove `usage_days`, `assistant_usage_events` and `assistant_tool_attempts` in one transaction. Stale-epoch retries cannot resurrect deleted data.
- The client checks account identity for every API call; pending tool metadata is capped at 500 and scoped to account/device/epoch. It is discarded on opt-out, account switch, epoch clear or after 13 days of offline storage.
- A client displaying the analytics page merges local buffered and remote records by UUID, preventing duplicate counts after a retry.
- No extra microphone, accessibility, or camera permission is requested for the metrics.

## User interface

The Analytics sidebar remains unchanged. Select **Assistant → Tools & Reliability** to see 14/30-day windows:

- Total attempts, accepted response percentage, failed+blocked, incomplete, median elapsed.
- Observed/acknowledged/cancelled/reference breakdown, P95 latency and explicitly unverified goal outcomes.
- Most-called tools, family/category distribution, failure reasons and per-tool failure/latency rows.
- Bounded post-failure follow-up heuristic, clearly distinguished from verified recovery.
- Empty state, loading state and truthful remote API error when migration is not yet applied.

The existing Dictation/Assistant summary stays unchanged.

## Deployment and validation

1. Deploy Phase A SQL migration first (already applied by the user). Then manually review/apply **`supabase/migrations/20261009150000_assistant_tool_reliability.sql`** to the same project before using a Phase B client.
2. Run `pnpm check`, `pnpm eval:tools`, Windows Rust and Android native CI. The PR should remain open until the latest-commit runs pass and manual QA is complete.
3. Test 3–5 flows:
   - **Successful read:** Ask Assistant to list notes (or another permitted read). Expect one observed attempt, tool category and latency; do not show verified task completion.
   - **Accepted action and cancellation:** Trigger copy or create-note and explicitly cancel a separate approval-required action. Confirm acknowledged/cancelled counts are distinct.
   - **Unavailable/error:** On Android, request a Windows-only action. Expect blocked/unavailable or failed status instead of a fabricated success.
   - **Retry and offline:** Repeat an unavailable action only after a new explicit request; counts are attempts. Test offline write retry; refresh should not double-count UUIDs.
   - **Consent / clear:** Disable Usage Intelligence, verify no new metrics; re-enable, clear Analytics and inspect from both devices. No old-epoch tool events may reappear.
4. Confirm Phase A Assistant session/turn counts and the dictation dashboard still match the previous version.

## Test coverage

`src/usage/assistantToolMetrics.test.ts`: tool-result classifications, private-content exclusions, cancellation vs reference, incomplete orphaned calls, opt-out/epoch/account transitions, duration cap, unknown-tool sanitization, and summary quantiles/denominators.

Tests do not establish accuracy against live Gemini usage without a labeled external sample. Backend SQL requires separate authenticated/RLS and cross-account integration tests during migration review.

## Future Phase C

No conversation semantic analysis, preference inference, goal modeling or personal playbook suggestions are implemented in Phase B. Those remain a separately scoped Phase C.
