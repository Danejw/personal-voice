# Personal Voice: shared conversations and memory
Prepared October 1, 2026.

## What this builds
One shared list of Assistant conversations across your Android phone, Windows laptop, and Windows desktop. You can reopen the same conversation anywhere. New conversations can use your preferences and relevant information from your existing notes and permitted cloud history.

This extends the existing application. It does not replace Gemini transcription, add another assistant provider, or require rebuilding the application.

## How to use
Give one numbered prompt at a time to your coding agent with access to Danejw/personal-voice. Let it finish, inspect its phase report, and then give it the next prompt. Each prompt includes its own operating instructions. Keep the same feature branch across phases.

Start with 01. It verifies the actual code and deployed database before the agent commits to a schema. Prompts 02–05 deliver shared conversations; 06 adds explicit personal memory. These form a useful first release. Prompts 07–08 add controlled learning and retrieval. Run 09 as the release audit; if shipping after 06, explicitly mark 07–08 deferred and audit only the implemented scope.

These files are instructions for future implementation. They do not change the repository or deploy anything.

## Code grounding and limits
Reference: main commit [8c3835a](https://github.com/Danejw/personal-voice/commit/8c3835a1b0e6e8fb29d3f9b5e8d2d40a13d11d88), version 0.3.9. Recheck current main before implementation.

The repository already has Supabase-backed voice notes, handoffs, account settings, devices, dictionary, usage, and opt-in cloud dictations. Assistant conversations currently rely on in-memory turns and bounded continuation payloads. Existing analytics-derived personal context is not a durable preference memory. Ending a session preserves visible turns in the reducer; this does not establish durable history or automatic context restoration.

Repository migrations were inspected; the actual deployed Supabase schema must still be verified. New table names and designs in these prompts are proposals, not claims that those tables already exist. A platform_preferences migration needs reconciliation with current types/services.

Relevant code: src/assistant/{AssistantController,AssistantSession,state,protocol,continuation,accountContext,personalContext}.ts; src/App.tsx; src/services; src/settings/deviceSettings.ts; src/types/database.ts; supabase/migrations. Paths should be reverified as the project evolves.

## Build order
- [01 — Verify the foundation](01-ground-truth.md)
- [02 — Add durable conversation storage](02-conversation-storage.md)
- [03 — Save and reopen Assistant conversations](03-saved-conversations.md)
- [04 — Share conversations reliably across devices](04-device-sync.md)
- [05 — Continue with the right conversation context](05-context-restoration.md)
- [06 — Remember preferences across separate conversations](06-explicit-memory.md)
- [07 — Learn useful preferences with user control](07-memory-learning.md)
- [08 — Find relevant existing notes and history](08-existing-knowledge.md)
- [09 — Validate the complete experience](09-final-validation.md)

## Product boundaries
- The same conversation can be viewed everywhere; only one device produces its live response at a time.
- Starting voice on another device requires an intentional local action.
- Conversation history, durable personal memory, and retrieval from old sources are related but distinct.
- Explicit memory comes first; automatic learning is optional and controllable.
- Preserve existing cloud consent and local device settings.
- Store transcripts and selected context, not raw microphone audio.
- Never silently replay actions from an old conversation.
- Forgotten preferences must not return through a stale summary, retry, or automatic extraction.
- An unavailable live database or physical device must be reported as unverified, never passed.

## Documentation to recheck when implementing
Use current official documentation for provider and database behavior. Avoid assuming a new model name or API capability from the date alone.
- [Gemini Live session management](https://ai.google.dev/gemini-api/docs/live-api/session-management)
- [Gemini Live tools](https://ai.google.dev/gemini-api/docs/live-api/tools)
- [Gemini Live capabilities](https://ai.google.dev/gemini-api/docs/live-api/capabilities)
- [Supabase Postgres Changes](https://supabase.com/docs/guides/realtime/postgres-changes)
- [Supabase row-level security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase storage access control](https://supabase.com/docs/guides/storage/security/access-control)



---

# 01 — Verify the foundation

Copy the following prompt into your coding agent:

---

You are implementing one phase of shared Assistant conversations and personal memory in Danejw/personal-voice. Work only on this phase; do not automatically proceed to the next.

Read the current AGENTS.md, docs/SPEC.md, docs/ARCHITECTURE.md, relevant source, migrations, and preceding reports in docs/Shared-Assistant-Phases/ before editing. The reference audit used main at 8c3835a1b0e6e8fb29d3f9b5e8d2d40a13d11d88 (version 0.3.9); verify the current checkout and adapt to changes. Do not assume the reference is still the latest main. Preserve uncommitted work. Use a dedicated feature branch/worktree from current main for phase 01 and continue that branch for later phases. Historical prompts for the old assistant branch are historical context, not branch instructions for this project.

Keep the existing Tauri 2 / React / TypeScript / Rust / Android platform architecture and Gemini integrations. Preserve direct device-to-Gemini live audio, ephemeral credentials, existing transcription cleanup, existing action permissions, and the borderless UI style. No raw microphone audio storage, new assistant provider, agent framework, or unrelated redesign. Supabase stores durable application state; a Gemini connection or resumption handle is not the conversation database.

The user has explicitly requested saved Assistant conversations and personal memory; update outdated V1 scope statements narrowly where necessary. Existing dictations, voice notes, handoffs, settings, and local device preferences must continue working. Never print credentials. Verify current official documentation before relying on provider-specific or Supabase API behavior; preserve the working model/API configuration unless this phase requires a verified change.

Implement the smallest complete version of this phase. Test meaningful failure cases, not merely implementation details. Run applicable lint, typecheck, tests, and build commands from the actual package scripts. Record PASS, FAIL, or NOT RUN honestly; emulator tests do not establish real-device success. If infrastructure access is unavailable, finish all safe local work and state exactly which live checks remain. Do not guess the production project or apply migrations to an unverified target. Apply remote changes only within existing authorization; otherwise leave reviewed migrations and deployment instructions ready.

Write docs/Shared-Assistant-Phases/01.md with actual changes, decisions, verification results, migration/deployment status, and remaining blockers. End with a plain-language explanation of what now works. Do not claim the phase complete until its acceptance criteria are verified; distinguish implementation complete from live/device verification pending.

## Phase-specific work

Goal: establish what exists before building, including the difference between repository migrations and the deployed Supabase schema. This phase changes documentation only.

Inspect AssistantController.ts, AssistantSession.ts, state.ts, protocol.ts, continuation.ts, accountContext.ts, personalContext.ts under src/assistant; App.tsx; the Assistant panel/hooks; src/services; src/settings/deviceSettings.ts; src/types/database.ts; and all Supabase migrations/functions.

Reference findings to verify, not blindly repeat:
- Assistant turns currently live in memory. End preserves visible turns, but ordinary later sessions do not automatically restore them as model history. Existing continuation handoffs copy a bounded transcript into a fresh session.
- personalContext.ts provides bounded usage-derived context, not durable personal preferences.
- Existing cloud data includes devices, dictionary, settings, voice_notes, handoffs, usage_days, remote device context/action requests, and opt-in dictations.
- A platform_preferences migration exists but was absent from generated types/current sync service. Determine whether it is deployed or used; do not make it a separate feature.
- Settings include cloud_dictation_history and server-owned usage_epoch. Device hotkeys, microphone, destination, and other preferences have local ownership.
- Current dictation listing is bounded; do not mistake the first page for the whole history.

If connected access exists, verify the correct Supabase project identity securely, deployed tables, columns, RLS, functions, indexes, publications, storage policies, and migration history. Use metadata queries without dumping private content. If unavailable, clearly mark live schema unverified and continue the repository audit.

Produce an implementation map: existing capability, source file/table, missing capability, proposed change. Propose additive assistant_conversations, assistant_messages, and assistant_memories, reusing anything equivalent already present. Define message identity/order, final versus partial turns, durable tool results, account ownership, and shared-device concurrency. Decide how one conversation can be viewed on several devices while only one device generates its live response. Specify a small server-enforced lease with fencing, plus reliable retries and deletion behavior.

Define the product behavior: one shared conversation list; reopen the same thread anywhere; separate new threads share account memory; ending voice input does not delete a thread; remote continuation requires an explicit local start of the microphone. Existing notes/dictations become potential context sources without bulk conversion into personal facts.

Acceptance: every implementation assumption has a source or is labeled proposed/unverified; no production data or app behavior changed. Deliver a concrete schema/API/state plan and rollout order usable by phase 02. Avoid turning this into an open-ended architecture exercise.



---

# 02 — Add durable conversation storage

Copy the following prompt into your coding agent:

---

You are implementing one phase of shared Assistant conversations and personal memory in Danejw/personal-voice. Work only on this phase; do not automatically proceed to the next.

Read the current AGENTS.md, docs/SPEC.md, docs/ARCHITECTURE.md, relevant source, migrations, and preceding reports in docs/Shared-Assistant-Phases/ before editing. The reference audit used main at 8c3835a1b0e6e8fb29d3f9b5e8d2d40a13d11d88 (version 0.3.9); verify the current checkout and adapt to changes. Do not assume the reference is still the latest main. Preserve uncommitted work. Use a dedicated feature branch/worktree from current main for phase 01 and continue that branch for later phases. Historical prompts for the old assistant branch are historical context, not branch instructions for this project.

Keep the existing Tauri 2 / React / TypeScript / Rust / Android platform architecture and Gemini integrations. Preserve direct device-to-Gemini live audio, ephemeral credentials, existing transcription cleanup, existing action permissions, and the borderless UI style. No raw microphone audio storage, new assistant provider, agent framework, or unrelated redesign. Supabase stores durable application state; a Gemini connection or resumption handle is not the conversation database.

The user has explicitly requested saved Assistant conversations and personal memory; update outdated V1 scope statements narrowly where necessary. Existing dictations, voice notes, handoffs, settings, and local device preferences must continue working. Never print credentials. Verify current official documentation before relying on provider-specific or Supabase API behavior; preserve the working model/API configuration unless this phase requires a verified change.

Implement the smallest complete version of this phase. Test meaningful failure cases, not merely implementation details. Run applicable lint, typecheck, tests, and build commands from the actual package scripts. Record PASS, FAIL, or NOT RUN honestly; emulator tests do not establish real-device success. If infrastructure access is unavailable, finish all safe local work and state exactly which live checks remain. Do not guess the production project or apply migrations to an unverified target. Apply remote changes only within existing authorization; otherwise leave reviewed migrations and deployment instructions ready.

Write docs/Shared-Assistant-Phases/02.md with actual changes, decisions, verification results, migration/deployment status, and remaining blockers. End with a plain-language explanation of what now works. Do not claim the phase complete until its acceptance criteria are verified; distinguish implementation complete from live/device verification pending.

## Phase-specific work

Goal: add the database and service foundation for saved conversations. Follow the phase 01 plan and resolve discrepancies before modifying schema.

Create additive migrations and typed services for assistant_conversations and assistant_messages, unless equivalent structures already exist. Conversations need account ownership, title, timestamps, revision/deletion semantics, and enough state to support the later active-device lease. Messages need stable client-generated identity, conversation ownership, role, content, source device, server-controlled ordering, timestamps, and a defined final/interrupted status. Store only necessary, sanitized citations and tool outcomes. Do not store provider credentials, raw microphone audio, or executable replay instructions.

Provide idempotent append and paginated reads. Retrying the same message must not create another row; conflicting reuse of an ID must fail or follow an explicit revision rule. Enforce account and conversation ownership at the database boundary, including references to another user's conversation. Client filtering alone is insufficient. Use authenticated RPC transactions where atomic operations are required; restrict grants and harden search_path for any SECURITY DEFINER function. Do not introduce a broadly privileged client key.

Define deletion so an old client retry cannot recreate a deleted conversation. Select a practical tombstone/version approach with bounded retention and document it. Ensure delete/update permissions and cascades are intentional. Preserve all existing tables, settings defaults, and usage_epoch write restrictions. Update generated database types through the project's established workflow.

Add focused integration coverage against an isolated database: owner can create/read/append; another account cannot; mismatched user/conversation references fail; duplicate retry is idempotent; ordering is deterministic under concurrent append; pagination has no gaps/duplicates; deleted conversations reject stale writes. Document any test that cannot run without Supabase.

Acceptance: migrations apply cleanly to a representative existing schema; old features and clients retain compatibility; service errors are explicit and typed; no UI feature is implied complete yet. Include reviewed deployment and rollback/disable instructions that preserve existing data. Do not deploy to an unverified project.



---

# 03 — Save and reopen Assistant conversations

Copy the following prompt into your coding agent:

---

You are implementing one phase of shared Assistant conversations and personal memory in Danejw/personal-voice. Work only on this phase; do not automatically proceed to the next.

Read the current AGENTS.md, docs/SPEC.md, docs/ARCHITECTURE.md, relevant source, migrations, and preceding reports in docs/Shared-Assistant-Phases/ before editing. The reference audit used main at 8c3835a1b0e6e8fb29d3f9b5e8d2d40a13d11d88 (version 0.3.9); verify the current checkout and adapt to changes. Do not assume the reference is still the latest main. Preserve uncommitted work. Use a dedicated feature branch/worktree from current main for phase 01 and continue that branch for later phases. Historical prompts for the old assistant branch are historical context, not branch instructions for this project.

Keep the existing Tauri 2 / React / TypeScript / Rust / Android platform architecture and Gemini integrations. Preserve direct device-to-Gemini live audio, ephemeral credentials, existing transcription cleanup, existing action permissions, and the borderless UI style. No raw microphone audio storage, new assistant provider, agent framework, or unrelated redesign. Supabase stores durable application state; a Gemini connection or resumption handle is not the conversation database.

The user has explicitly requested saved Assistant conversations and personal memory; update outdated V1 scope statements narrowly where necessary. Existing dictations, voice notes, handoffs, settings, and local device preferences must continue working. Never print credentials. Verify current official documentation before relying on provider-specific or Supabase API behavior; preserve the working model/API configuration unless this phase requires a verified change.

Implement the smallest complete version of this phase. Test meaningful failure cases, not merely implementation details. Run applicable lint, typecheck, tests, and build commands from the actual package scripts. Record PASS, FAIL, or NOT RUN honestly; emulator tests do not establish real-device success. If infrastructure access is unavailable, finish all safe local work and state exactly which live checks remain. Do not guess the production project or apply migrations to an unverified target. Apply remote changes only within existing authorization; otherwise leave reviewed migrations and deployment instructions ready.

Write docs/Shared-Assistant-Phases/03.md with actual changes, decisions, verification results, migration/deployment status, and remaining blockers. End with a plain-language explanation of what now works. Do not claim the phase complete until its acceptance criteria are verified; distinguish implementation complete from live/device verification pending.

## Phase-specific work

Goal: a conversation survives closing and reopening the application, initially with one active device.

Connect the new services to the existing Assistant controller/state model and UI. Add a compact shared conversation list with create, open, rename, and delete. Keep interaction consistent with the current borderless app. Preserve familiar Assistant start/end behavior. A new thread has its own conversation ID; opening a saved thread displays its persisted messages. Ending a session stops live work without deleting the transcript.

Capture finalized user and assistant turns at the actual reducer/controller boundaries. Inspect how partial transcriptions, userFinal, interruption, and turnComplete currently behave. Assign stable IDs before writes. Avoid saving the same final text twice or presenting unfinished output as completed. Define what happens to interrupted assistant speech and a user turn interrupted by connection failure. Keep transient streaming text separate from durable finalized records.

Bind every asynchronous read/write to the authenticated account, conversation ID, and controller generation. Switching thread, signing out, or changing accounts must prevent stale callbacks from modifying the new screen or writing to the wrong thread. Restore the most recently opened conversation with account-scoped local state, not a global pointer shared between accounts.

Make save state visible but unobtrusive: saving, saved, and retry/recover when necessary. Add a small durable account-scoped pending-write store using the existing supported persistence mechanism; no external queue platform. A crash after server commit but before local acknowledgment must be safe to retry. Never silently discard an unsaved user turn.

Do not yet claim semantic continuation is finished: this phase persists/displays the transcript; phase 05 restores bounded model context. Make that distinction clear in implementation reports.

Acceptance: create a conversation, speak/type, end, restart, and see the same messages with stable IDs; retry after network failure creates no duplicates; interrupted responses have honest status; switching accounts or threads during a slow write does not leak content; deleting a thread cannot be undone by pending writes. Existing V1 continuation handoffs remain readable. Add meaningful state/service tests and report actual platform coverage.



---

# 04 — Share conversations reliably across devices

Copy the following prompt into your coding agent:

---

You are implementing one phase of shared Assistant conversations and personal memory in Danejw/personal-voice. Work only on this phase; do not automatically proceed to the next.

Read the current AGENTS.md, docs/SPEC.md, docs/ARCHITECTURE.md, relevant source, migrations, and preceding reports in docs/Shared-Assistant-Phases/ before editing. The reference audit used main at 8c3835a1b0e6e8fb29d3f9b5e8d2d40a13d11d88 (version 0.3.9); verify the current checkout and adapt to changes. Do not assume the reference is still the latest main. Preserve uncommitted work. Use a dedicated feature branch/worktree from current main for phase 01 and continue that branch for later phases. Historical prompts for the old assistant branch are historical context, not branch instructions for this project.

Keep the existing Tauri 2 / React / TypeScript / Rust / Android platform architecture and Gemini integrations. Preserve direct device-to-Gemini live audio, ephemeral credentials, existing transcription cleanup, existing action permissions, and the borderless UI style. No raw microphone audio storage, new assistant provider, agent framework, or unrelated redesign. Supabase stores durable application state; a Gemini connection or resumption handle is not the conversation database.

The user has explicitly requested saved Assistant conversations and personal memory; update outdated V1 scope statements narrowly where necessary. Existing dictations, voice notes, handoffs, settings, and local device preferences must continue working. Never print credentials. Verify current official documentation before relying on provider-specific or Supabase API behavior; preserve the working model/API configuration unless this phase requires a verified change.

Implement the smallest complete version of this phase. Test meaningful failure cases, not merely implementation details. Run applicable lint, typecheck, tests, and build commands from the actual package scripts. Record PASS, FAIL, or NOT RUN honestly; emulator tests do not establish real-device success. If infrastructure access is unavailable, finish all safe local work and state exactly which live checks remain. Do not guess the production project or apply migrations to an unverified target. Apply remote changes only within existing authorization; otherwise leave reviewed migrations and deployment instructions ready.

Write docs/Shared-Assistant-Phases/04.md with actual changes, decisions, verification results, migration/deployment status, and remaining blockers. End with a plain-language explanation of what now works. Do not claim the phase complete until its acceptance criteria are verified; distinguish implementation complete from live/device verification pending.

## Phase-specific work

Goal: phone, laptop, and desktop show the same durable conversations without producing competing assistant responses.

Implement subscriptions and catch-up against the durable Supabase records. Handle the subscribe/query race, missed events, reconnect, out-of-order delivery, duplicate delivery, and app background/resume. Use deterministic message identity/order and server revisions as appropriate. Realtime notifications improve freshness; they are not the durable history. Preserve the project's platform lifecycle boundaries.

Implement a server-enforced, expiring lease for the active conversation producer with a fencing generation/version. Only the holder can commit generated responses and begin new tool work for that conversation. Renewal, takeover, expiration, and final commit must be atomic where necessary. A second device can view the conversation and explicitly choose Continue here; it must not automatically enable its microphone. Explain the current active device in simple UI text.

Takeover invalidates the old generation. Stop the old live connection and reject late writes/tool starts even if its disconnect event arrives late. An external action already executed cannot be undone by a lease: record known results honestly, reconcile uncertain results, and never automatically replay them. Preserve existing action-review settings.

Specify offline behavior honestly: cached history remains readable; failed saves show pending/recovery states. Do not promise offline Gemini conversation. After lease expiration, do not keep generating shared work or silently merge conflicting assistant branches. Preserve locally captured unsaved user text for explicit recovery instead of losing it. Keep any pending store small and account-scoped. Respect deletion tombstones and clear caches on account changes.

Migrate Continue on another device toward opening the saved conversation ID where supported, while preserving parsing of PV_ASSISTANT_CONTINUATION_V1 payloads. Avoid duplicate imported conversations/messages; verify ownership of referenced threads.

Acceptance: two simultaneous viewers converge; only one produces; takeover during speech fences stale output; background/foreground catches up; disconnect after successful commit retries safely; deletion propagates and survives offline reconnect; account B cannot access account A's cache or lease. Test race conditions at service/state level and document a real Android + two-Windows-device smoke-test script. Do not mark that script passed unless it was actually run.



---

# 05 — Continue with the right conversation context

Copy the following prompt into your coding agent:

---

You are implementing one phase of shared Assistant conversations and personal memory in Danejw/personal-voice. Work only on this phase; do not automatically proceed to the next.

Read the current AGENTS.md, docs/SPEC.md, docs/ARCHITECTURE.md, relevant source, migrations, and preceding reports in docs/Shared-Assistant-Phases/ before editing. The reference audit used main at 8c3835a1b0e6e8fb29d3f9b5e8d2d40a13d11d88 (version 0.3.9); verify the current checkout and adapt to changes. Do not assume the reference is still the latest main. Preserve uncommitted work. Use a dedicated feature branch/worktree from current main for phase 01 and continue that branch for later phases. Historical prompts for the old assistant branch are historical context, not branch instructions for this project.

Keep the existing Tauri 2 / React / TypeScript / Rust / Android platform architecture and Gemini integrations. Preserve direct device-to-Gemini live audio, ephemeral credentials, existing transcription cleanup, existing action permissions, and the borderless UI style. No raw microphone audio storage, new assistant provider, agent framework, or unrelated redesign. Supabase stores durable application state; a Gemini connection or resumption handle is not the conversation database.

The user has explicitly requested saved Assistant conversations and personal memory; update outdated V1 scope statements narrowly where necessary. Existing dictations, voice notes, handoffs, settings, and local device preferences must continue working. Never print credentials. Verify current official documentation before relying on provider-specific or Supabase API behavior; preserve the working model/API configuration unless this phase requires a verified change.

Implement the smallest complete version of this phase. Test meaningful failure cases, not merely implementation details. Run applicable lint, typecheck, tests, and build commands from the actual package scripts. Record PASS, FAIL, or NOT RUN honestly; emulator tests do not establish real-device success. If infrastructure access is unavailable, finish all safe local work and state exactly which live checks remain. Do not guess the production project or apply migrations to an unverified target. Apply remote changes only within existing authorization; otherwise leave reviewed migrations and deployment instructions ready.

Write docs/Shared-Assistant-Phases/05.md with actual changes, decisions, verification results, migration/deployment status, and remaining blockers. End with a plain-language explanation of what now works. Do not claim the phase complete until its acceptance criteria are verified; distinguish implementation complete from live/device verification pending.

## Phase-specific work

Goal: reopening a saved conversation on another device lets the Assistant understand what has already happened.

Build context from the durable conversation, using the existing Gemini session/provider boundary. Seed history at the correct connection-ready point once per fresh session; distinguish actual provider resumption from a new connection so turns are not duplicated. Verify the current model/API's supported history and multimodal inputs in official documentation. Keep the existing working model and token constraints unless a specific verified change is necessary.

Use recent messages plus a bounded summary of older conversation content; keep canonical messages intact. Summaries must identify the exact covered message revision/watermark. Reject a stale summary after edits/deletions or a competing summary job. Do not summarize every partial transcript. Set explicit context budgets and expose recovery for failed summaries. Preserve unresolved questions, decisions, user corrections, and tool outcomes without treating old instructions/tool calls as commands to execute again.

Persist explicitly attached notes, selections, and handoff context as appropriate, including provenance and capture time. If restoring screenshots is implemented, use private account-owned storage with verified policies and attachment metadata; do not store expiring signed URLs as durable identity. Handle upload failure, access expiration, orphan cleanup, and deletion. Never imply metadata alone restores image pixels. If image support cannot be completed in this phase, show an explicit unavailable attachment state and report it as a scoped limitation.

Distinguish historical context from current device reality. A desktop screenshot from yesterday is not the phone's current screen. Refresh current platform capabilities and permissions at session start. Access to a remote device still uses the existing owned-device tools and permissions.

Ensure deletion, edited messages, or later memory forgetting invalidate affected summaries/cached context. Tool outcomes can explain past work but must not cause action replay.

Acceptance: start on phone, discuss a decision, end, reopen on Windows, and answer a follow-up correctly from saved context; long histories stay within the chosen budget; a new session receives each turn once; genuine resumed sessions do not double-seed; deleted/corrected content is not reintroduced through stale summaries; unavailable attachments are acknowledged; old actions are never replayed. Test construction of context separately from nondeterministic model responses and report model smoke-test results honestly.



---

# 06 — Remember preferences across separate conversations

Copy the following prompt into your coding agent:

---

You are implementing one phase of shared Assistant conversations and personal memory in Danejw/personal-voice. Work only on this phase; do not automatically proceed to the next.

Read the current AGENTS.md, docs/SPEC.md, docs/ARCHITECTURE.md, relevant source, migrations, and preceding reports in docs/Shared-Assistant-Phases/ before editing. The reference audit used main at 8c3835a1b0e6e8fb29d3f9b5e8d2d40a13d11d88 (version 0.3.9); verify the current checkout and adapt to changes. Do not assume the reference is still the latest main. Preserve uncommitted work. Use a dedicated feature branch/worktree from current main for phase 01 and continue that branch for later phases. Historical prompts for the old assistant branch are historical context, not branch instructions for this project.

Keep the existing Tauri 2 / React / TypeScript / Rust / Android platform architecture and Gemini integrations. Preserve direct device-to-Gemini live audio, ephemeral credentials, existing transcription cleanup, existing action permissions, and the borderless UI style. No raw microphone audio storage, new assistant provider, agent framework, or unrelated redesign. Supabase stores durable application state; a Gemini connection or resumption handle is not the conversation database.

The user has explicitly requested saved Assistant conversations and personal memory; update outdated V1 scope statements narrowly where necessary. Existing dictations, voice notes, handoffs, settings, and local device preferences must continue working. Never print credentials. Verify current official documentation before relying on provider-specific or Supabase API behavior; preserve the working model/API configuration unless this phase requires a verified change.

Implement the smallest complete version of this phase. Test meaningful failure cases, not merely implementation details. Run applicable lint, typecheck, tests, and build commands from the actual package scripts. Record PASS, FAIL, or NOT RUN honestly; emulator tests do not establish real-device success. If infrastructure access is unavailable, finish all safe local work and state exactly which live checks remain. Do not guess the production project or apply migrations to an unverified target. Apply remote changes only within existing authorization; otherwise leave reviewed migrations and deployment instructions ready.

Write docs/Shared-Assistant-Phases/06.md with actual changes, decisions, verification results, migration/deployment status, and remaining blockers. End with a plain-language explanation of what now works. Do not claim the phase complete until its acceptance criteria are verified; distinguish implementation complete from live/device verification pending.

## Phase-specific work

Goal: the user can explicitly teach, inspect, correct, and remove personal memories that are available on every device and in new conversations.

Add assistant_memories through an additive migration, with account ownership, stable identity, memory kind/key/value, scope, provenance/source references, creation/update timestamps, revision, and active/superseded/deleted state as needed. Keep the design small. Separate persistent preferences/facts from conversation summaries and existing analytics-derived personalContext. Reuse settings only where their established meaning truly matches; do not turn device settings into a global preference blob.

Support explicit instructions such as Remember that I prefer short answers, Change that preference, and Forget that. Add narrow typed tools or the existing equivalent with server-validated ownership and value limits. Fetch only the current account's memories. Do not allow arbitrary SQL or client-supplied account impersonation.

Provide a simple memory screen showing what is remembered, why/source where available, and edit/delete controls. Changes synchronize across phone and Windows. Corrections supersede prior values deterministically; explicit user corrections outrank extracted guesses. Define whether deleting a source also deletes dependent memory and expose a sensible default.

Inject a bounded relevant set of active memories into new and resumed conversations. Refresh when memory revision changes; replace/restart session context if the provider cannot remove a forgotten fact from a live session. Do not claim that deleting one database row removes already-injected context.

Implement forgetting without resurrection: exclude forgotten entries from personalization, automatic extraction, and cached summaries/context derived for that purpose. Retained original conversation text may still contain the words; distinguish Forget this preference from Delete the source conversation. Track scoped suppression/provenance sufficient to prevent passive re-learning from the same source, while allowing a later explicit Remember instruction. Do not hide source text from a deliberate user request to view their own transcript.

Acceptance: an explicit preference learned on Android affects a new Windows conversation; edit wins over old context; forget removes personalization on all devices and remains forgotten after retry/restart; another account cannot read it; two edits have an intentional conflict rule. No automatic learning or historical backfill in this phase. Show examples and document actual tests.



---

# 07 — Learn useful preferences with user control

Copy the following prompt into your coding agent:

---

You are implementing one phase of shared Assistant conversations and personal memory in Danejw/personal-voice. Work only on this phase; do not automatically proceed to the next.

Read the current AGENTS.md, docs/SPEC.md, docs/ARCHITECTURE.md, relevant source, migrations, and preceding reports in docs/Shared-Assistant-Phases/ before editing. The reference audit used main at 8c3835a1b0e6e8fb29d3f9b5e8d2d40a13d11d88 (version 0.3.9); verify the current checkout and adapt to changes. Do not assume the reference is still the latest main. Preserve uncommitted work. Use a dedicated feature branch/worktree from current main for phase 01 and continue that branch for later phases. Historical prompts for the old assistant branch are historical context, not branch instructions for this project.

Keep the existing Tauri 2 / React / TypeScript / Rust / Android platform architecture and Gemini integrations. Preserve direct device-to-Gemini live audio, ephemeral credentials, existing transcription cleanup, existing action permissions, and the borderless UI style. No raw microphone audio storage, new assistant provider, agent framework, or unrelated redesign. Supabase stores durable application state; a Gemini connection or resumption handle is not the conversation database.

The user has explicitly requested saved Assistant conversations and personal memory; update outdated V1 scope statements narrowly where necessary. Existing dictations, voice notes, handoffs, settings, and local device preferences must continue working. Never print credentials. Verify current official documentation before relying on provider-specific or Supabase API behavior; preserve the working model/API configuration unless this phase requires a verified change.

Implement the smallest complete version of this phase. Test meaningful failure cases, not merely implementation details. Run applicable lint, typecheck, tests, and build commands from the actual package scripts. Record PASS, FAIL, or NOT RUN honestly; emulator tests do not establish real-device success. If infrastructure access is unavailable, finish all safe local work and state exactly which live checks remain. Do not guess the production project or apply migrations to an unverified target. Apply remote changes only within existing authorization; otherwise leave reviewed migrations and deployment instructions ready.

Write docs/Shared-Assistant-Phases/07.md with actual changes, decisions, verification results, migration/deployment status, and remaining blockers. End with a plain-language explanation of what now works. Do not claim the phase complete until its acceptance criteria are verified; distinguish implementation complete from live/device verification pending.

## Phase-specific work

Goal: reduce repeated Remember commands while keeping memory accurate and easy to control. Build on the working explicit-memory feature.

Add an account-level automatic-learning setting with clear behavior; ship opt-in initially. Explicit memory commands must continue to work when automatic learning is off. Analyze finalized persisted Assistant turns in small bounded batches, not live microphone chunks or every token. Use the existing Gemini provider/backend patterns with current verified text-model support; do not invent a model ID or put permanent credentials in clients.

Extract only durable, attributable information: clear first-person preferences, stable facts, and ongoing projects that help future conversations. Draft messages, quotations, hypothetical examples, third-party facts, screenshots, dictated text intended for someone else, and model-generated assertions are not automatically personal truth. Keep uncertain inferences as candidates rather than active memory. Clear explicit user statements can become active under the enabled policy; avoid constant confirmation interruptions.

Store provenance, extraction version, confidence/category, and source revision. Make processing idempotent per source/revision/extractor version. Validate source ownership by reading authorized database records, not by trusting supplied user IDs or arbitrary text. Recheck suppression, deletion, and corrections at commit time. Manual corrections and explicit instructions outrank automatic extraction. Contradictions should update a justified value or become a visible candidate, not silently overwrite a trusted preference.

Use minimal bounded processing and retries. Add a small durable job marker only if required for reliable operation; no agent orchestration framework or external queue infrastructure. Do not automatically import the user's entire history. Existing voice notes and cloud dictations remain outside automatic learning unless a separate clear user control permits those sources; cloud dictation sync consent alone is not consent to extract personal facts.

Acceptance: genuine preferences are learned once; quoted/drafted preferences are not; failed/repeated jobs create no duplicates; deletion during extraction blocks commit; forgotten facts do not return; disabling learning stops new extraction; explicit edits survive delayed extraction. Build a small labeled fixture set from synthetic examples, record precision failures, and tighten eligibility before activation. The UI lets the user see and remove newly learned facts with minimal effort.



---

# 08 — Find relevant existing notes and history

Copy the following prompt into your coding agent:

---

You are implementing one phase of shared Assistant conversations and personal memory in Danejw/personal-voice. Work only on this phase; do not automatically proceed to the next.

Read the current AGENTS.md, docs/SPEC.md, docs/ARCHITECTURE.md, relevant source, migrations, and preceding reports in docs/Shared-Assistant-Phases/ before editing. The reference audit used main at 8c3835a1b0e6e8fb29d3f9b5e8d2d40a13d11d88 (version 0.3.9); verify the current checkout and adapt to changes. Do not assume the reference is still the latest main. Preserve uncommitted work. Use a dedicated feature branch/worktree from current main for phase 01 and continue that branch for later phases. Historical prompts for the old assistant branch are historical context, not branch instructions for this project.

Keep the existing Tauri 2 / React / TypeScript / Rust / Android platform architecture and Gemini integrations. Preserve direct device-to-Gemini live audio, ephemeral credentials, existing transcription cleanup, existing action permissions, and the borderless UI style. No raw microphone audio storage, new assistant provider, agent framework, or unrelated redesign. Supabase stores durable application state; a Gemini connection or resumption handle is not the conversation database.

The user has explicitly requested saved Assistant conversations and personal memory; update outdated V1 scope statements narrowly where necessary. Existing dictations, voice notes, handoffs, settings, and local device preferences must continue working. Never print credentials. Verify current official documentation before relying on provider-specific or Supabase API behavior; preserve the working model/API configuration unless this phase requires a verified change.

Implement the smallest complete version of this phase. Test meaningful failure cases, not merely implementation details. Run applicable lint, typecheck, tests, and build commands from the actual package scripts. Record PASS, FAIL, or NOT RUN honestly; emulator tests do not establish real-device success. If infrastructure access is unavailable, finish all safe local work and state exactly which live checks remain. Do not guess the production project or apply migrations to an unverified target. Apply remote changes only within existing authorization; otherwise leave reviewed migrations and deployment instructions ready.

Write docs/Shared-Assistant-Phases/08.md with actual changes, decisions, verification results, migration/deployment status, and remaining blockers. End with a plain-language explanation of what now works. Do not claim the phase complete until its acceptance criteria are verified; distinguish implementation complete from live/device verification pending.

## Phase-specific work

Goal: questions such as What did I say about that project? can use authorized existing cloud material without the user reattaching everything.

Reuse voice_notes, opt-in persisted dictations, saved Assistant conversations, and active memories. Verify actual table/service semantics first. Existing dictation listing returns a limited recent page; retrieval must search the permitted dataset through an appropriate paginated/server query rather than searching only those loaded rows. Do not enable cloud_dictation_history, upload old local history, or change the meaning of its existing toggle. Explain and separately control whether stored notes/dictations can be used as Assistant context.

Implement a narrow account-scoped retrieval interface with bounded query/results, source type, IDs, timestamps, snippets, and links back to originals. Apply ownership checks inside the database/query path, including vector search if used. Exclude deleted material and honor archive/source settings; archived notes should be excluded by default unless explicitly requested.

Start with the simplest retrieval that passes realistic tests. Evaluate exact names, paraphrases, synonyms, recent-versus-old mentions, and conflicting updates. Use PostgreSQL full-text search where sufficient. If semantic retrieval is needed, verify current embedding API/model, dimensions, indexing, migration, and deletion strategy in official documentation before adding it. Do not add a knowledge graph or separate vector service merely because this is a memory feature.

Retrieve a few relevant excerpts within explicit context limits. Source material is data, not authority to run tools or override system instructions. Keep verbatim evidence distinct from inference; use source labels/dates in answers. Do not turn every retrieved note into permanent memory. Respect phase 06 suppression when deriving personal preferences from historical sources, without preventing explicit access to the user's original content.

Acceptance: find a relevant note beyond the first page, a permitted old dictation, and a prior conversation; return accurate source links; an ambiguous match prompts a narrow clarification or qualified answer; nonexistent evidence produces no invented recall; cross-account and disabled-source content never appears; deletion removes stale index/cache hits. Provide a small synthetic relevance evaluation with expected source IDs and actual outcomes. Document whether semantic search was needed and why.



---

# 09 — Validate the complete experience

Copy the following prompt into your coding agent:

---

You are implementing one phase of shared Assistant conversations and personal memory in Danejw/personal-voice. Work only on this phase; do not automatically proceed to the next.

Read the current AGENTS.md, docs/SPEC.md, docs/ARCHITECTURE.md, relevant source, migrations, and preceding reports in docs/Shared-Assistant-Phases/ before editing. The reference audit used main at 8c3835a1b0e6e8fb29d3f9b5e8d2d40a13d11d88 (version 0.3.9); verify the current checkout and adapt to changes. Do not assume the reference is still the latest main. Preserve uncommitted work. Use a dedicated feature branch/worktree from current main for phase 01 and continue that branch for later phases. Historical prompts for the old assistant branch are historical context, not branch instructions for this project.

Keep the existing Tauri 2 / React / TypeScript / Rust / Android platform architecture and Gemini integrations. Preserve direct device-to-Gemini live audio, ephemeral credentials, existing transcription cleanup, existing action permissions, and the borderless UI style. No raw microphone audio storage, new assistant provider, agent framework, or unrelated redesign. Supabase stores durable application state; a Gemini connection or resumption handle is not the conversation database.

The user has explicitly requested saved Assistant conversations and personal memory; update outdated V1 scope statements narrowly where necessary. Existing dictations, voice notes, handoffs, settings, and local device preferences must continue working. Never print credentials. Verify current official documentation before relying on provider-specific or Supabase API behavior; preserve the working model/API configuration unless this phase requires a verified change.

Implement the smallest complete version of this phase. Test meaningful failure cases, not merely implementation details. Run applicable lint, typecheck, tests, and build commands from the actual package scripts. Record PASS, FAIL, or NOT RUN honestly; emulator tests do not establish real-device success. If infrastructure access is unavailable, finish all safe local work and state exactly which live checks remain. Do not guess the production project or apply migrations to an unverified target. Apply remote changes only within existing authorization; otherwise leave reviewed migrations and deployment instructions ready.

Write docs/Shared-Assistant-Phases/09.md with actual changes, decisions, verification results, migration/deployment status, and remaining blockers. End with a plain-language explanation of what now works. Do not claim the phase complete until its acceptance criteria are verified; distinguish implementation complete from live/device verification pending.

## Phase-specific work

Goal: establish whether this feature is ready for the user's Android phone, Windows laptop, and Windows desktop. Audit and fix within the implemented scope; do not add more product features.

Review all phase reports and actual changes against latest repository guidance. Resolve integration gaps, duplicated state, unsafe assumptions, stale types, and incorrect documentation. Verify that saved conversations, Gemini sessions, personal memories, summaries, existing sources, device capabilities, and active-device ownership have distinct responsibilities.

Run applicable project commands, confirming exact scripts first: pnpm lint, pnpm typecheck, pnpm test, pnpm build. Where native changes or repository release requirements warrant them, run cargo fmt --manifest-path src-tauri/Cargo.toml -- --check; cargo check --locked --manifest-path src-tauri/Cargo.toml; cargo clippy --locked --manifest-path src-tauri/Cargo.toml -- -D warnings; and the supported Tauri/Android build commands. Do not claim Windows/Android validation from unsupported host builds.

Use a clean test account and authorized deployed test environment for this journey:
1. Start a conversation on Android, establish a preference and a project decision, and finish a response.
2. Reopen the same conversation on the laptop; confirm transcript and semantic continuity.
3. Continue on the desktop while the laptop is open; verify explicit takeover and stale-writer fencing.
4. Start a new conversation; verify the preference transfers but unrelated transcript is not dumped into context.
5. Correct and forget the preference; verify all devices and fresh/resumed sessions honor it.
6. Retrieve an eligible voice note, older dictation, and old conversation with real source references.
7. Interrupt a reply, disconnect during save, restart, expire the lease, and replay retries; verify no duplicate messages or lost recoverable user text.
8. Delete a thread/memory while another device is offline; reconnect and verify no resurrection.
9. Sign out and into another account during an in-flight request; verify no data, cache, attachment, lease, or context leakage.
10. Verify existing dictation cleanup, insertion, voice-note save, handoff, dictionary, usage, remote actions, settings, and old continuation payloads still work.

Audit RLS/storage/RPC grants, private attachment access, ownership relationships, signed URL lifetime, server-side source validation, secret handling, bounded context, retry limits, and obsolete cache cleanup. Test migrations against existing data and older client behavior.

Deliver a concise readiness report distinguishing automated PASS/FAIL from manual NOT RUN. List only concrete blockers, with reproducible steps. Provide safe rollout order: additive backend/schema first, compatible client builds next, guarded enablement after checks; document disabling the feature without dropping saved data. Do not publish a release, merge, or change production configuration unless separately authorized. The outcome must clearly say what is implemented, what was actually tested, and what still requires the user's devices.

