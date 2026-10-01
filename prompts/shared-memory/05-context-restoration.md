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
