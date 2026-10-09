# Phase C — Your Assistant Insights & Personal Playbook Drafts

**Pull request:** #31, based on PR #30 (which is based on PR #29).
**Rollout status:** Code committed for review; SQL and Edge Function are not deployed by GitHub PR creation.

## User experience

The **Insights → Your Assistant** tab is separate from the original Your Voice / Suggestions / Compaction tabs.

1. The user opts in to **this analysis run** by checking the consent box and clicking **Analyze my Assistant use**. There is no scheduled/background analysis and no model invocation when viewing the tab.
2. The app uses a bounded, signed-in, owner-checked RPC to retrieve the **latest 80 finalized user messages** across the **12 most recently updated non-deleted conversations**, even if any thread has been continued over many sessions. Source messages matching basic secret-related terms are omitted before model invocation; this is a best-effort filter, not guaranteed redaction.
3. Only user text excerpts (up to 500 characters/message), message IDs, conversation IDs and timestamps are sent to the authenticated `assistant-insights` function, which calls Gemini. No Assistant replies, tool responses, screenshots or audio are sent. This step may incur Gemini API charges **only upon the user's explicit action**.
4. The model may propose **workflow**, **adaptation**, or **goal** suggestions. A local grounding parser rejects any source IDs not actually in the supplied sample, duplicates and evidence below threshold. Workflows require 3 distinct cited messages; adaptations and goals require 2. Those thresholds do not independently validate the truth of the model's interpretation—users review proposals.
5. Each candidate shows reason, next step and source count. **Review source messages** fetches saved messages again under the current account and displays referenced excerpts, without requesting Gemini.
6. **Dismiss** hides the item; **Don't suggest again** permanently mutes that normalized fingerprint for future runs; **Save suggestion for review** retains adaptations/goals without changing settings, memory or goal state.
7. For a workflow, **Review and save draft** exposes an editable title and 2–8 plain-language steps. Saving creates a **user-owned Personal Playbook draft**. The draft has **no executor, scheduler or action permissions** and cannot rewrite system-level tool playbooks.

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
2. Run Phase C SQL `20261009160000_assistant_insights_playbook_drafts.sql` in the **same Supabase project**. Confirm RPC grant, RLS policies, and the composite draft ownership foreign key.
3. Deploy new Edge Function `supabase/functions/assistant-insights`. Configure the existing server-side `GEMINI_API_KEY`; never embed a secret in Windows/Android.
4. Release client only after migrations and function deploy succeed. Failure to deploy function leaves the analysis action unavailable; other Insights tabs remain intact.
5. No automatic SQL or Gemini calls are initiated merely by opening or merging the PR.

## Manual test plan

1. **Consent:** Open Insights → Your Assistant. Merely opening/reloading does not call Gemini. The Analyze button is disabled until consent is checked. Clicking Analyze sends only saved user text excerpts (the selected sample) to the function.
2. **Long conversation:** Use a conversation that spans many sessions. The RPC returns recent user messages rather than the *oldest* messages of the thread. The sample is capped at 80 messages / 12 conversations; it is not an exhaustive lifetime profile.
3. **Grounded suggestions:** Trigger repeated user messages asking for the same workflow in 3+ separate messages. Check each suggested source message via the source preview. One-off or unsupported patterns should not yield recommendations.
4. **Adaptation/goals:** Repeated explicit communication preferences or stated goals may produce reviewable suggestions. They should not update memory, personal preferences or goals automatically.
5. **Playbook draft:** Edit proposed steps, save the draft, reload Insights and inspect the saved title and steps. Verify no Assistant tool is called and the system `get_tool_playbook` behavior is unchanged.
6. **Feedback:** Dismiss/mute an item, run analysis again and verify it does not return to pending under the same fingerprint. Saved suggestions and personal drafts persist across devices.
7. **Isolation:** Change signed-in account, list candidates/drafts and check that one account cannot see or modify the other's results. Delete source conversation: existing evidence references may become unavailable and must be described as such, not fabricated.
8. **Failure handling:** Missing migration, missing Edge Function, unavailable Gemini API and fewer than 6 saved user messages produce user-visible errors with no false success.
9. **Regression:** Dictation Insights analyze/accept/compact remain unchanged, Analytics A/B remain intact, no new tool declarations, no model calls during ordinary Assistant conversations.

## Tests

`src/insights/assistantInsights.test.ts` includes conservative parser validation for real source IDs, workflow threshold, adaptation/goal threshold, duplicate fingerprints, kind-specific step rules, saved status and malformed model output.

CI should run `pnpm check`, offline tool regression suite, Windows Rust checks/tests, Android debug APK and Kotlin unit tests. A successful CI build does not deploy Supabase SQL or Edge Functions.
