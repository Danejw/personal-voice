# PR23 — Assistant Tool Playbooks

## Purpose

Build on the **merged PR22 Tool Intelligence Registry** at commit `222b566307aa83ccfe860af955b58d084e31d3d8`.

Teach Personal Voice's Gemini 3.8 Live assistant **how to combine existing tools**, not just how to choose a single tool. Keep the model's voice latency low and preserve permissions, execution, and session behavior.

## Architecture

1. The 53 existing tools remain unchanged, retaining their names, arguments, routes, permissions, and executors.
2. **One new read-only tool**, `get_tool_playbook({ id })`, raises the total Live function declarations to **54**.
3. The setup prompt advertises seven short playbook names and instructs Gemini to retrieve only when a task genuinely requires multi-tool coordination or dependencies are uncertain. Routine requests skip lookup.
4. A tool request validates an ID against a strict seven-value allowlist in `decideToolCall`. The controller responds using the same synchronous Live function-response mechanism as every other tool.
5. The reply is locally generated, JSON-structured, bounded, and side-effect-free. It includes conditional steps, alternative tool routes, recovery guidance, and an observable completion condition. Loading guidance **never** executes the workflow.
6. Playbooks reference existing `AssistantToolName` types; an automated drift test fails if a step names a tool absent from Gemini declarations.

## On-demand playbook catalog

| Playbook ID | Purpose |
| --- | --- |
| `screen_understanding` | Choose pointer, selection, screenshot, and accessibility evidence |
| `windows_control` | Find, activate, inspect, change, and verify Windows UI |
| `notes_workflow` | Locate notes and safely distinguish create/edit/archive/restore/delete |
| `memory_recall` | Distinguish semantic memory, explicit memory, reading threads, and continuing threads |
| `cross_device` | Decide between remote read, handoff, remote dictation, and remote actions |
| `content_delivery` | Route text/photo payloads to clipboard, focused field, device, or image destination |
| `camera_context` | Choose camera still, continuous context, photo paste, and stop |

Each playbook has `useWhen`, `skipWhen`, conditional `steps`, `branches`, `recovery`, and `completion`. The procedures are advisory; Gemini must still select steps from actual user intent and observed results.

## Runtime boundaries

- No new API, Gemini submodel, SDK, database, migrations, permission checks, or automation.
- The `get_tool_playbook` tool uses a local constant registry only; it does not access account data, inspect a device, or run another model.
- No blanket instructions to get playbooks before every action.
- No unbounded planning loops; a playbook is a guide, not a task planner/executor.
- Long playbook content is not included in every Live session setup.
- Existing `toolQueue`, `toolEpoch`, tool responses, session restoration, and approval pathways stay intact.

## Testing

```bash
pnpm check
pnpm exec vitest run src/assistant/harness/playbooks/playbooks.test.ts src/assistant/harness/evals/traceScore.test.ts src/assistant/AssistantController.test.ts
```

- All seven playbooks resolve and only refer to currently declared tools.
- Retrieval validates exact IDs; invalid IDs are rejected before any other action.
- Local playbook tool responses are bounded and contain no unsupported shell/selection operations.
- AssistantController returns playbook content through Gemini's existing tool-response path.
- PR22's golden fixtures are expanded to 81 total: **54 tool-specific, 20 disambiguation, seven no-tool**.
- Existing Windows and Android GitHub Validate jobs must pass. These tests verify mechanics, not model accuracy or real on-device task success.

## Manual smoke test

1. Ask for a complex Windows workflow: it may call `get_tool_playbook({ id: "windows_control" })`, then inspect and act using existing tools.
2. Ask a quick single-tool command (copy text, take a screenshot, save a new note): assistant should avoid unnecessary playbook retrieval.
3. Ask to find an earlier conversation and then explicitly continue it: ensure it distinguishes retrieval from thread switching.
4. Ask to transfer text to another device, then separately to type it into a remote active field: ensure different tools are chosen.
5. Confirm microphone, camera, memory, notes, confirmation behavior, and Android/Windows apps work as before.

## Next PRs

- PR24: tool result interpretation, actionable failure categories, and end-state verification.
- PR25: dynamic task/device capability context, and optimized playbook/tool guidance.
- PR26: live model traces and true task-completion evals rather than self-scored golden fixtures.
