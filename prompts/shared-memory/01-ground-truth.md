# 01 — Verify the foundation

Copy the following prompt into your coding agent:

---

You are implementing one phase of shared Assistant conversations and personal memory in Danejw/personal-voice. Work only on this phase; do not automatically proceed to the next.

Read the current AGENTS.md, docs/SPEC.md, docs/ARCHITECTURE.md, relevant source, migrations, and preceding reports in docs/Shared-Assistant-Phases/ before editing. The reference audit used main at 8c3835a1b0e6e8fb29d3f9b5e8d2d40a13d11d88 (version 0.3.9); verify the current checkout and adapt to changes. Do not assume the reference is still the latest main. Preserve uncommitted work. Use a dedicated feature branch/worktree from current main for phase 01 and continue that branch for later phases. Historical prompts for the old assistant branch are historical context, not branch instructions for this project.

Keep the existing Tauri 2 / React / TypeScript / Rust / Android platform architecture and Gemini integrations. Preserve direct device-to-Gemini live audio, ephemeral credentials, existing transcription cleanup, existing action permissions, and the borderless UI style. No raw microphone audio storage, new assistant provider, agent framework, or unrelated redesign. Supabase stores durable application state; a Gemini connection or resumption handle is not the conversation database.

The user has explicitly requested saved Assistant conversations and personal memory; update outdated V1 scope statements narrowly where necessary. Existing dictations, notes, handoffs, settings, and local device preferences must continue working. Never print credentials. Verify current official documentation before relying on provider-specific or Supabase API behavior; preserve the working model/API configuration unless this phase requires a verified change.

Implement the smallest complete version of this phase. Test meaningful failure cases, not merely implementation details. Run applicable lint, typecheck, tests, and build commands from the actual package scripts. Record PASS, FAIL, or NOT RUN honestly; emulator tests do not establish real-device success. If infrastructure access is unavailable, finish all safe local work and state exactly which live checks remain. Do not guess the production project or apply migrations to an unverified target. Apply remote changes only within existing authorization; otherwise leave reviewed migrations and deployment instructions ready.

Write docs/Shared-Assistant-Phases/01.md with actual changes, decisions, verification results, migration/deployment status, and remaining blockers. End with a plain-language explanation of what now works. Do not claim the phase complete until its acceptance criteria are verified; distinguish implementation complete from live/device verification pending.

## Phase-specific work

Goal: establish what exists before building, including the difference between repository migrations and the deployed Supabase schema. This phase changes documentation only.

Inspect AssistantController.ts, AssistantSession.ts, state.ts, protocol.ts, continuation.ts, accountContext.ts, personalContext.ts under src/assistant; App.tsx; the Assistant panel/hooks; src/services; src/settings/deviceSettings.ts; src/types/database.ts; and all Supabase migrations/functions.

Reference findings to verify, not blindly repeat:
- Assistant turns currently live in memory. End preserves visible turns, but ordinary later sessions do not automatically restore them as model history. Existing continuation handoffs copy a bounded transcript into a fresh session.
- personalContext.ts provides bounded usage-derived context, not durable personal preferences.
- Existing cloud data includes devices, dictionary, settings, notes, handoffs, usage_days, remote device context/action requests, and opt-in dictations.
- A platform_preferences migration exists but was absent from generated types/current sync service. Determine whether it is deployed or used; do not make it a separate feature.
- Settings include cloud_dictation_history and server-owned usage_epoch. Device hotkeys, microphone, destination, and other preferences have local ownership.
- Current dictation listing is bounded; do not mistake the first page for the whole history.

If connected access exists, verify the correct Supabase project identity securely, deployed tables, columns, RLS, functions, indexes, publications, storage policies, and migration history. Use metadata queries without dumping private content. If unavailable, clearly mark live schema unverified and continue the repository audit.

Produce an implementation map: existing capability, source file/table, missing capability, proposed change. Propose additive assistant_conversations, assistant_messages, and assistant_memories, reusing anything equivalent already present. Define message identity/order, final versus partial turns, durable tool results, account ownership, and shared-device concurrency. Decide how one conversation can be viewed on several devices while only one device generates its live response. Specify a small server-enforced lease with fencing, plus reliable retries and deletion behavior.

Define the product behavior: one shared conversation list; reopen the same thread anywhere; separate new threads share account memory; ending voice input does not delete a thread; remote continuation requires an explicit local start of the microphone. Existing notes/dictations become potential context sources without bulk conversion into personal facts.

Acceptance: every implementation assumption has a source or is labeled proposed/unverified; no production data or app behavior changed. Deliver a concrete schema/API/state plan and rollout order usable by phase 02. Avoid turning this into an open-ended architecture exercise.
