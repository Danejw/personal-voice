# PR24 — Tool Result Intelligence, Verification and Recovery

## Goal

Build on merged PR22 (53-tool intelligence profiles) and PR23 (seven on-demand playbooks and a 54th `get_tool_playbook` tool).

The assistant must distinguish **a command being accepted** from **the user's objective being accomplished**. After failures, it should choose recovery based on observed evidence instead of repeating unsuccessful calls or guessing new locators.

## Implementation

- `src/assistant/harness/toolResults.ts`: pure structured assessment of every completed Live tool response, including:
  - `status`: observed / acknowledged / reference / incomplete / failed / cancelled / blocked.
  - `evidence`: returned read data, attached capture, action acknowledgement, reference, or none.
  - `goal_verified: null`: explicitly **unknown**, never fabricated as success.
  - `failure_kind`: cancellation, busy, invalid arguments, stale target, offline, unavailable, transient, or unknown.
  - `failure_streak`: capped at 2, counted by tool name within the current local session, without storing arguments or private text.
  - `verification_hint`: references the PR22 per-tool profile; describes what should be checked, not what has been checked.
  - `next_step`: short guidance for appropriate follow-up.
- Live `assistantToolResponse` retains legacy `{result: ...}` and `{error: ...}` fields. Controller supplies an additional `interpretation` field for Gemini; there is no new provider call.
- PR23 playbook lookup is tagged **reference**: loading a playbook is not an action.
- Read-only inspections/screenshots are tagged **observed** (data is evidence, not a task-completion guarantee).
- Mutating commands are tagged **acknowledged** unless a separate observation proves the end state.
- The existing supervised Computer Use loop can return `Stopped after 8 steps` or `Stopped. Nothing further was done.` through a normal success path; such results are tagged **incomplete**, not successful goal completion.
- Confirmation cancellation returns **cancelled**, explicitly advising not to retry without a new user request.
- Repeated failures stop yielding retry suggestions after the second failure, while preserving tool execution and user approval semantics.
- Already-finished tool records exclude playbook lookup and mark known incomplete screen tasks as incomplete.

## Deliberately unchanged

- All 54 tool names, parameters, and dispatch routes.
- Tauri commands, Windows UIA, camera, Android, cross-device transport, and Supabase storage.
- User confirmations, auto-run settings, and the Computer Use action allowlist.
- Microphone/session lifecycle, Gemini Live wire tool IDs, and synchronous responses.
- **No automatic retries**, synthetic screenshot verification, new model, DB migration, extra permissions, or background operations.

## Examples

| Tool outcome | Model-facing interpretation | Model's recommended next step |
| --- | --- | --- |
| Read a note | `observed` | Answer from returned data |
| Screenshot | `observed` / capture attached | Reason from current still only |
| Text insertion returned | `acknowledged` | Don't assert destination was independently inspected |
| Windows action target stale | `failed` / stale target | Reinspect target before another attempt |
| Another action pending | `blocked` / busy | Wait for or resolve existing action |
| User cancelled | `cancelled` | Stop; don't retry |
| Two consecutive failures | `failed` / streak 2 | Report blocker, don't repeat same call blindly |
| Supervised task stopped at 8 steps | `incomplete` | Report incomplete work; no automatic restart |

## Automated validation

```bash
pnpm check
pnpm exec vitest run src/assistant/harness/toolResults.test.ts src/assistant/AssistantController.test.ts src/assistant/protocol.test.ts
```

Tests cover semantic classifications, fail streak and reset, no private content echoed in metadata, backwards-compatible legacy fields, exact call IDs, no unsolicited retries, and clean controller operation. GitHub's Windows and Android jobs should pass.

**Important:** deterministic classification tests do not prove real end-to-end task completion. PR26 will add real model traces and independently observed end states.

## Manual testing (quick)

1. **Screen evidence:** Ask, "What is on my screen?" Expect a fresh capture, answer grounded in that still, and no claim that a separate UI action was completed.
2. **Acknowledged action:** Ask the assistant to insert text into a focused harmless field. Expect the action to run with your existing approval mode and confirmation wording; the assistant should not invent further UI state.
3. **Recovery:** While pointing at a stale/unavailable control, ask for a UI action. Expect it to reinspect rather than retry the same stale target blindly.
4. **Cancelled request:** With review mode enabled, request a harmless note action and cancel. Expect no action and no automatic repeat.
5. **Playbooks and simple tasks:** Ask for a complex Windows workflow, then a simple copy. The former may load a playbook; the latter should stay direct. Verify normal Android/Windows voice sessions still work.

## Next PRs

- PR25: context-aware tool guidance tied to current task/device capabilities.
- PR26: live model traces, result-verification evals, and measured baseline comparisons.
