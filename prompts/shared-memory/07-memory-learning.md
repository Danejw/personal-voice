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
