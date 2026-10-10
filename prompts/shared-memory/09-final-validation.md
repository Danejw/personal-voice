# 09 — Validate the complete experience

Copy the following prompt into your coding agent:

---

You are implementing one phase of shared Assistant conversations and personal memory in Danejw/personal-voice. Work only on this phase; do not automatically proceed to the next.

Read the current AGENTS.md, docs/SPEC.md, docs/ARCHITECTURE.md, relevant source, migrations, and preceding reports in docs/Shared-Assistant-Phases/ before editing. The reference audit used main at 8c3835a1b0e6e8fb29d3f9b5e8d2d40a13d11d88 (version 0.3.9); verify the current checkout and adapt to changes. Do not assume the reference is still the latest main. Preserve uncommitted work. Use a dedicated feature branch/worktree from current main for phase 01 and continue that branch for later phases. Historical prompts for the old assistant branch are historical context, not branch instructions for this project.

Keep the existing Tauri 2 / React / TypeScript / Rust / Android platform architecture and Gemini integrations. Preserve direct device-to-Gemini live audio, ephemeral credentials, existing transcription cleanup, existing action permissions, and the borderless UI style. No raw microphone audio storage, new assistant provider, agent framework, or unrelated redesign. Supabase stores durable application state; a Gemini connection or resumption handle is not the conversation database.

The user has explicitly requested saved Assistant conversations and personal memory; update outdated V1 scope statements narrowly where necessary. Existing dictations, notes, handoffs, settings, and local device preferences must continue working. Never print credentials. Verify current official documentation before relying on provider-specific or Supabase API behavior; preserve the working model/API configuration unless this phase requires a verified change.

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
6. Retrieve an eligible note, older dictation, and old conversation with real source references.
7. Interrupt a reply, disconnect during save, restart, expire the lease, and replay retries; verify no duplicate messages or lost recoverable user text.
8. Delete a thread/memory while another device is offline; reconnect and verify no resurrection.
9. Sign out and into another account during an in-flight request; verify no data, cache, attachment, lease, or context leakage.
10. Verify existing dictation cleanup, insertion, note save, handoff, dictionary, usage, remote actions, settings, and old continuation payloads still work.

Audit RLS/storage/RPC grants, private attachment access, ownership relationships, signed URL lifetime, server-side source validation, secret handling, bounded context, retry limits, and obsolete cache cleanup. Test migrations against existing data and older client behavior.

Deliver a concise readiness report distinguishing automated PASS/FAIL from manual NOT RUN. List only concrete blockers, with reproducible steps. Provide safe rollout order: additive backend/schema first, compatible client builds next, guarded enablement after checks; document disabling the feature without dropping saved data. Do not publish a release, merge, or change production configuration unless separately authorized. The outcome must clearly say what is implemented, what was actually tested, and what still requires the user's devices.
