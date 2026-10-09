# AGENTS.md

## Purpose

These rules apply to Cursor, Codex, and any other coding agent working in this repository.

Read these files before changing code:

1. `docs/SPEC.md`
2. `docs/ARCHITECTURE.md`
3. the prompt for the current implementation phase
4. `docs/PV-Phases/` if the work is a Personal Voice (PV) prompt — completed vs skipped phases are listed there

The repository now includes **both** dictation and a Gemini Live Assistant with a typed/tool-use harness. For changes under `src/assistant/`, also read `src/assistant/harness/AGENTS.md` and the relevant `docs/Assistant-Phases/` reports. A phase report or spec may describe historical behavior; **the checked-in implementation, current declarations, validation/permission logic and tests are authoritative**. Never infer current tool availability solely from an old document or a remembered tool count.

## Current application architecture (verify against source before editing)

- One Tauri 2/React/TypeScript application with Rust Windows integration and an Android Kotlin/native boundary; shared account/device/sync services.
- Dictation and the Assistant are different flows. Dictation uses the selected Transcribe Live provider and inserts or stores a transcript; the interactive Assistant uses the Gemini Live model configured in `src/assistant/protocol.ts` and tool declarations from `src/assistant/tools.ts`.
- Assistant sessions, confirmations, serialized tool execution and responses live in `src/assistant/AssistantSession.ts` and `src/assistant/AssistantController.ts`. The user's current approval/auto-run settings remain authoritative.
- The Assistant can use notes, memories, saved conversation recall, analytics/insights, screen/camera context, Windows accessibility, and explicitly supported cross-device actions. Inspect the **actual** declarations and platform adapters; do not assume every tool is available locally on Android.
- Tool-selection intelligence, on-demand playbooks, context-aware guidance, result classification and evaluation are implemented under `src/assistant/harness/`. This is a lightweight extension of existing Gemini Live tool use—not a second planner, new provider or blanket permission system.
- Operational design references: `docs/Assistant-Phases/16-tool-intelligence-harness.md` through `docs/Assistant-Phases/20-tool-use-evaluation-framework.md`; consult the latest relevant source as well.

## Mandatory Assistant tool-change workflow

**Definition of done:** A PR that creates, renames, changes, removes or changes the semantics/platform/permission of **any Assistant tool** MUST review and update every affected harness layer *in the same PR*. Do not ship a declared tool that the harness does not understand. Follow the detailed decision table and change checklist in `src/assistant/harness/AGENTS.md`.

1. **Discover the existing tool and neighbors first.** Search exact names, schemas, call sites, platform handlers, tests, docs and playbooks. Check which names appear in the current `assistantFunctionDeclarations()` output; counts are derived from code and may change.
2. **Declare and validate it together:** edit `src/assistant/tools.ts` to add/change/remove the Gemini Live name, description, JSON argument schema, `decideToolCall()` validation and typed `ToolDecision`/confirmation union where needed. Reject malformed inputs and unknown names. Make sure a real supported executor path exists in `AssistantController` plus applicable `src/app/` and Windows/Android adapters. Handle failures and preserve approval semantics.
3. **Keep model intelligence synchronized:** edit `src/assistant/harness/toolIntelligence.ts` for one accurate entry per declared tool (`family`, platform, `when`, `avoid`, `next`, `verify`, disambiguation hint). Consider competing tools and concise Live guidance. Do not document unsupported capabilities as available.
4. **Maintain procedures and context:** search `src/assistant/harness/playbooks/` and `contextAssembler.ts` for references and task selection, conditional prerequisites, platform/availability notes, recovery and completion evidence. Update affected playbooks and on-demand summaries; add a playbook only for a genuinely reusable multi-step workflow. Do not inflate every Live session with large instructions.
5. **Maintain result interpretation:** update `src/assistant/harness/toolResults.ts` when evidence type or failure/completion behavior changes. An acknowledgement is not independent end-state verification. Preserve structured `result`/`error` contract.
6. **Maintain regression coverage:** add/update/remove the `tool-<name>` scenario in `src/assistant/harness/evals/fixtures.ts` and add ambiguity, no-tool, Windows/Android, typed/voice and failure/recovery cases wherever affected. Update `tools.test.ts`, controller tests, playbook tests, context/result tests and the mock corpus when semantics change. Update explicit tool/scenario counts in tests and prose **when the real set changes**; avoid unsourced hard-coded totals.
7. **Run and report:** `pnpm check` and `pnpm eval:tools`; review both Windows and Android GitHub Validate jobs and manually exercise the changed tool including negative and cancellation cases. CI's scripted corpus checks harness behavior, **not live model accuracy**. For high-impact routing changes, opt in to real-model trace capture, verify outcomes separately and label sample sizes.

**Tool removal:** remove the declaration, decision/route/executor, affected confirmation handling, registry entry, fixtures and references *together*; replace broken workflow steps with a supported alternative or remove them. Review any persisted/historical references and plan compatibility without replaying old calls. Never remove permission protections merely to make a tool pass tests.

**Tool parameter, capability or provider change:** even if the tool name stays identical, repeat the audit for argument validation, platform availability, side-effect/approval behavior, model description, playbooks and tests. Parity checks alone cannot detect semantic drift.

**Unrelated PRs:** if a change impacts tool access, behaviors or context indirectly, perform the same impact check. When no harness update is appropriate, explain why in the PR description.

**Assistant Analytics contract:** `src/usage/AssistantUsageStore.ts` and `assistantUsage.ts` record metadata-only finalized turns, sessions and bounded activity (Phase A). Never duplicate saved text or derive duration from historical conversations. The `assistant_usage_events` migration and `write_assistant_usage_event` RPC enforce account, consent and epoch protection; `clear_usage_analytics()` must continue to clear both Assistant and dictation metadata. Tool reliability (Phase B) and personalized Assistant Insights (Phase C) must remain separate and require their own review. Refer to `docs/Assistant-Phases/21-assistant-usage-analytics.md`.


## Core rules

- Preserve one Tauri 2 codebase for Windows and Android.
- Keep shared product logic in TypeScript/Rust wherever practical.
- Keep OS-specific behavior behind a platform boundary.
- Do not scatter Windows/Android conditionals throughout the app.
- Do not create a separate Android product or separate Android business-logic codebase.
- Android-specific native features may live in a small Kotlin-backed Tauri plugin.
- Do not introduce Electron.
- Do not introduce another transcription provider in V1.
- Do not introduce a local speech model in V1.
- Do not proxy live microphone audio through our backend.
- Never embed a permanent Gemini API key in a shipped client.
- Keep Gemini-specific behavior behind a provider/session interface.
- Keep platform-specific behavior behind a platform adapter.
- Prefer the smallest implementation that satisfies the active phase.
- Do not implement future phases early.
- Do not redesign unrelated code.
- Do not add packages without a concrete need.
- Pin important dependencies rather than using floating versions.
- Use TypeScript strict mode.
- Keep Rust formatted and warning-free where practical.
- Add tests for shared logic and state transitions.
- Do not claim a phase is complete until its acceptance criteria have been tested.
- Every PR summary must include: changes made, CI/test status, a short 3–5 step **manual test with expected results**, unresolved issues, and whether it is ready to merge. Never mark pending checks green.
- UI is borderless: do not add CSS/HTML borders (or faux inset-ring shadows). Separate surfaces with background, spacing, radius, and soft shadows. See `.cursor/rules/no-borders.mdc`.

## Simplicity rule

This is a personal app first.

Avoid:

- enterprise abstractions
- plugin marketplaces
- microservices
- event buses
- queues
- analytics infrastructure
- billing
- teams
- transcript warehouses
- multiple ASR providers
- unnecessary dependency injection frameworks

Use simple interfaces only where they protect important boundaries.

## Required architectural boundaries

### Voice provider boundary

Conceptually:

```ts
interface TranscriptionSession {
  connect(): Promise<void>;
  startUtterance(): Promise<void>;
  sendAudio(chunk: ArrayBuffer): Promise<void>;
  endUtterance(): Promise<void>;
  close(): Promise<void>;
}
```

Exact names may change.

Gemini implementation belongs behind this boundary.

### Platform boundary

Conceptually:

```ts
interface PlatformAdapter {
  startCapture(): Promise<void>;
  stopCapture(): Promise<void>;
  insertText(text: string): Promise<void>;
  showListeningIndicator(): Promise<void>;
  hideListeningIndicator(): Promise<void>;
}
```

Exact method shapes may differ if implementation realities require it.

### State model

Use an explicit state machine or reducer around:

```text
IDLE
CONNECTING
LISTENING
FINALIZING
INSERTING
ERROR
```

Do not model the lifecycle with many unrelated booleans.

## Security

- Permanent Google API credentials belong only in the secure backend.
- Client receives short-lived credentials/tokens only.
- Do not log API keys or short-lived tokens.
- Do not permanently store microphone audio.
- Do not sync microphone audio.
- Saved Assistant conversation text may be stored for the signed-in account. Automatic dictation transcript warehouses stay out of scope. Microphone audio is never stored or synced.

## Git discipline

For each phase:

- keep changes scoped to the phase
- document important architecture decisions
- run tests/builds
- report exactly what changed
- report unresolved issues truthfully
- do not silently continue into the next phase
- update the root `README.md` **in the same PR** whenever user-visible capabilities, app navigation, platform support, setup steps, security/privacy behavior, tooling, tests, or release procedures materially change; verify every command/link and avoid hard-coded version numbers that drift
- when README does not need a change, do not churn it; explain any material documentation exception in the PR summary
- if modifying an Assistant tool, describe which declaration/router/registry/playbook/evaluation paths changed and list Windows/Android smoke tests

## When APIs differ from this spec

If a current official API differs from these documents:

1. preserve the intended architecture
2. use the current official API
3. document the deviation in the implementation summary
4. update the relevant project doc if the difference is durable
