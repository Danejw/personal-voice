# 06 — Remember preferences across separate conversations

Copy the following prompt into your coding agent:

---

You are implementing one phase of shared Assistant conversations and personal memory in Danejw/personal-voice. Work only on this phase; do not automatically proceed to the next.

Read the current AGENTS.md, docs/SPEC.md, docs/ARCHITECTURE.md, relevant source, migrations, and preceding reports in docs/Shared-Assistant-Phases/ before editing. The reference audit used main at 8c3835a1b0e6e8fb29d3f9b5e8d2d40a13d11d88 (version 0.3.9); verify the current checkout and adapt to changes. Do not assume the reference is still the latest main. Preserve uncommitted work. Use a dedicated feature branch/worktree from current main for phase 01 and continue that branch for later phases. Historical prompts for the old assistant branch are historical context, not branch instructions for this project.

Keep the existing Tauri 2 / React / TypeScript / Rust / Android platform architecture and Gemini integrations. Preserve direct device-to-Gemini live audio, ephemeral credentials, existing transcription cleanup, existing action permissions, and the borderless UI style. No raw microphone audio storage, new assistant provider, agent framework, or unrelated redesign. Supabase stores durable application state; a Gemini connection or resumption handle is not the conversation database.

The user has explicitly requested saved Assistant conversations and personal memory; update outdated V1 scope statements narrowly where necessary. Existing dictations, notes, handoffs, settings, and local device preferences must continue working. Never print credentials. Verify current official documentation before relying on provider-specific or Supabase API behavior; preserve the working model/API configuration unless this phase requires a verified change.

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
