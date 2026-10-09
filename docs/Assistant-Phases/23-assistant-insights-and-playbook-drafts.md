# Phase C — Your Assistant Insights & Personal Playbook Drafts

**Pull request:** #31, based on PR #30 (which is based on PR #29).
**Rollout status:** Code committed for review; SQL and Edge Function are not deployed by GitHub PR creation.

## User experience

The **Insights → Your Assistant** tab mirrors the Dictation **Your Voice** experience: an analyzed free-form communication-style profile, practical communication tips, measured usage statistics and visual distributions, followed by analysis-readiness progress. **Insights → Suggestions** remains the shared review queue for Dictation and Assistant recommendations; each retains its own data and approval semantics.

1. Assistant Insights follows the existing dictation Insights experience: the page displays readiness and progress, and the user clicks **Analyze my Assistant** (first run) or **Refresh insights** when eligible. No extra consent checkbox is shown. Clicking the clearly labeled action authorizes sending the recent saved user-message sample to the configured Gemini function for that analysis. No scheduled/background model inference occurs.
2. Readiness loads and counts a bounded sample **without running the model**. The app uses a bounded, signed-in, owner-checked RPC to retrieve the **latest 80 finalized user messages** across the **12 most recently updated non-deleted conversations**, even if any thread has been continued over many sessions. Source messages matching basic secret-related terms are omitted before model invocation; this is a best-effort filter, not guaranteed redaction.
3. Only user text excerpts (up to 500 characters/message), message IDs, conversation IDs and timestamps are sent to the authenticated `assistant-insights` function, which calls Gemini. No Assistant replies, tool responses, screenshots or audio are sent. This step may incur Gemini API charges **only upon the user's explicit action**.
4. The model may propose **workflow**, **adaptation**, or **goal** suggestions. A local grounding parser rejects any source IDs not actually in the supplied sample, duplicates and evidence below threshold. Workflows require 3 distinct cited messages; adaptations and goals require 2. Those thresholds do not independently validate the truth of the model's interpretation—users review proposals.
5. The unified **Suggestions** tab displays a combined pending count (Dictation + Assistant). Both sources use the same card styling, evidence disclosure and primary **Save/Review** plus secondary **Dismiss** actions. Assistant source preview fetches saved messages again under the current account without requesting Gemini.
6. **Dismiss** hides the item; Assistant-only **More options → Don't suggest again** mutes that normalized fingerprint for future runs. Saving an Assistant adaptation/goal keeps it for later review but does not change settings, memory or goal state.
7. For a workflow, **Review and save draft** expands a matching dark-theme editor with a title and 2–8 plain-language steps. Suggested steps and evidence remain in compact disclosures until opened. Saving creates a **user-owned Personal Playbook draft**, listed in the shared Suggestions area. It has **no executor, scheduler or action permissions** and cannot rewrite system-level tool playbooks.

### Communication profile and measured usage (follow-up UI iteration)

- The deployed `assistant-insights` Edge Function must now return `voiceProfile` (a bounded natural-language communication-style narrative grounded in sampled user messages), `communicationTips` (0–4 optional actionable suggestions), and the pre-existing `candidates` array. Old Edge Function versions that only return candidates are rejected with a deploy instruction; they do not create an empty analysis run.
- Run records persist the profile and tips. Previous runs remain intact, with NULL profile; the app enables **Generate my profile** for existing users with enough saved messages, without requiring 30 new messages just to backfill the profile.
- **Peak day, peak time, device breakdown, voice/typed split, user-turn count and tool activity** are derived from recorded Assistant usage (Phase A) and tool attempt metadata (Phase B), scoped to the current account and usage epoch, and limited to the latest 30 days. This is deliberately separate from text analysis: a model must never invent usage statistics.
- Day grouping uses each event's originating local day. Time-of-day grouping uses the **viewing device's** local time zone for the UTC timestamp. The source application/window associated with an Assistant interaction is **not recorded** by Phase A, so the app shows tool categories rather than fabricating an Applications breakdown.
- Prior saved conversations may contribute to the narrative profile, but they must **not** be backfilled as measured usage, device events, active time, or tool calls. The display uses the same `voice-profile`, `insights-stat-row`, `HorizontalShareBars` and `DeviceSplitBar` presentation as Dictation Insights.

This phase intentionally does **not** implement automatic creation of executable workflows, on-device background observation, changing user memories, changing communication settings, autonomous goal tracking, or claiming a goal is completed from a tool acknowledgement.

## Data and isolation

Migration: `supabase/migrations/20261009160000_assistant_insights_playbook_drafts.sql`.

- `assistant_insight_runs`: timestamp and counts, no raw conversation content.
- `assistant_insight_candidates`: kind, fingerprint, review status, summary/reason/next step and source message IDs. Holds *generated suggestions*, not complete messages.
- `assistant_personal_playbook_drafts`: approved draft title/steps only, with composite candidate-and-owner foreign key. No executable tool calls.
- `list_assistant_insight_samples(p_limit)`: bounded, user-owned and deleted-thread-filtered source read, with explicit auth check and authenticated-only RPC grant.
- Each table has owner-scoped RLS for authenticated reads and writes. Saved/muted/dismissed fingerprints remain stable across subsequent analyses through conflict-ignoring inserts.
- Account switch and active-tab gating prevent the component from exposing previously loaded account data. Analysis additionally checks account identity after the Gemini response before saving.

## Separation of responsibilities

| System | Role |
| --- | --- |
| Analytics Phase A | Deterministic sessions/turns/time/devices |
| Analytics Phase B | Tool attempts/outcomes/failures/performance |
| Insights Phase C | Evidence-backed behavior/goal/workflow suggestions from explicit user input |
| System playbooks | Version-controlled developer tool guidance |
| Personal drafts | Account-owned, user-approved *descriptions* of candidate workflows |

No new Gemini Live Assistant tool was declared and no changes to existing tool permissions or confirmation flows were introduced.

## Required rollout order

1. Ensure Phase A SQL `20261009140000_assistant_usage_analytics.sql` was deployed (user reported it applied). Phase B SQL `20261009150000_assistant_tool_reliability.sql` must be deployed before releasing the Phase B app; it is independent of the Phase C migration.
2. Run Phase C SQL `20261009160000_assistant_insights_playbook_drafts.sql` in the **same Supabase project**, then apply the additive profile migration **`20261009170000_assistant_communication_profile.sql`**. The second migration is required even if the earlier Phase C schema is already installed.
3. Deploy/redeploy the updated Edge Function `supabase/functions/assistant-insights`. Configure the existing server-side `GEMINI_API_KEY`; never embed a secret in Windows/Android. If previously deployed, **redeploy it again** for profile output.
4. Release client only after migrations and function deploy succeed. Failure to deploy function leaves the analysis action unavailable; other Insights tabs remain intact.
5. No automatic SQL or Gemini calls are initiated merely by opening or merging the PR.

## Manual test plan

1. **Readiness/explicit action:** Open Insights → Your Assistant. Confirm the first analysis requires **12 saved user messages across at least 2 active days**. After a run, the next refresh requires **30 new messages**, or **7 days with at least 10 new messages**. Inspect the progress rails and confirm the button is disabled until ready. Opening the page never calls Gemini; clicking **Analyze my Assistant / Refresh insights** sends only the selected saved user-message sample to the function.
2. **Long conversation:** Use a conversation that spans many sessions. The RPC returns recent user messages rather than the *oldest* messages of the thread. The sample is capped at 80 messages / 12 conversations; it is not an exhaustive lifetime profile.
3. **Shared Suggestions:** With both sources populated, the unified Suggestions badge and summary show total pending Dictation + Assistant recommendations. Dictation categories retain their action behavior. Assistant source cards match `.insight-candidate-card`, `.candidate-actions`, `.record`, `.secondary` and evidence disclosures. Switching to Your Assistant retains progress/profile but shows no duplicate recommendation cards.
4. **Adaptation/goals:** Repeated explicit communication preferences or stated goals may produce reviewable suggestions. They should not update memory, personal preferences or goals automatically.
   - **Profile/usage regression:** First-generation profile matches the Dictation profile's free-form layout. A previous run without a saved profile can generate one on demand. Refresh loads the persisted profile and helpful tips across devices. If event history is empty, measured device/hour statistics show no-data states, not inferred numbers; tool categories are shown only when logged.
5. **Playbook draft:** Expand a workflow card's Review and save draft editor; fields use dark-theme styles. Edit and save, then reload the shared Suggestions tab and inspect the saved draft. Verify no Assistant tool is called and the system `get_tool_playbook` behavior is unchanged.
6. **Feedback:** Dismiss/mute an item, run analysis again and verify it does not return to pending under the same fingerprint. Saved suggestions and personal drafts persist across devices.
7. **Isolation:** Change signed-in account, list candidates/drafts and check that one account cannot see or modify the other's results. Delete source conversation: existing evidence references may become unavailable and must be described as such, not fabricated.
8. **Failure handling:** Missing migration, missing Edge Function, unavailable Gemini API or insufficient recent saved messages produce visible errors or a non-ready state, with no false success.
9. **Regression:** Dictation Insights analyze/accept/compact remain unchanged, Analytics A/B remain intact, no new tool declarations, no model calls during ordinary Assistant conversations.

## Tests

`src/insights/assistantInsights.test.ts` includes conservative parser validation for real source IDs, workflow threshold, adaptation/goal threshold, duplicate fingerprints, kind-specific step rules, saved status and malformed model output.

CI should run `pnpm check`, offline tool regression suite, Windows Rust checks/tests, Android debug APK and Kotlin unit tests. A successful CI build does not deploy Supabase SQL or Edge Functions.
