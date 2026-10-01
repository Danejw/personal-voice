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
