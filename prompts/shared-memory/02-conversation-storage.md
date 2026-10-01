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
