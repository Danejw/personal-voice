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
