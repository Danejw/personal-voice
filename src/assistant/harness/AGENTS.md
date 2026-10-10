# Assistant Harness — AGENTS.md

Applies to all code under `src/assistant/harness/`. Read the root `AGENTS.md` first.

## Source of truth and design invariants

1. `src/assistant/tools.ts` defines the **actual** Gemini Live functions through `assistantFunctionDeclarations()`, parses calls, validates names/arguments through `decideToolCall()` and produces typed `ToolDecision` variants. This is the authoritative exposed catalog. Tool names, schemas and availability must never be guessed from documentation.
2. `src/assistant/AssistantController.ts` dispatches tool decisions, preserves confirmation/auto-run policy, serializes calls and sends synchronous `assistantToolResponse` objects. `src/assistant/AssistantSession.ts` transports them. Actual effects are performed via existing `src/app/` actions and platform adapters, not in playbooks.
3. `src/assistant/harness/toolIntelligence.ts` provides one complete intent/routing/verification profile **per declared function**, including `get_tool_playbook`. Tool declarations and profiles must match 1:1.
4. `playbooks/` defines conditional, reusable **read-only guidance** for multi-step tasks. `playbooks/index.ts` is the allowlisted loader. A playbook is not an executor, and the model should not fetch one for simple one-tool tasks.
5. `contextAssembler.ts` emits small platform-aware notes using trusted device facts; extra deterministic task hints currently apply to typed turns. Live declarations are chosen at socket setup; do not assume they can be changed mid-session.
6. `toolResults.ts` interprets `observed`, `acknowledged`, `reference`, `incomplete`, `failed`, `cancelled` and `blocked` outcomes, with bounded recovery hints. Preserve legacy result/error fields. A tool ACK is **never** independent goal verification.
7. `evals/` defines golden tool-selection scenarios, a pure trace scorer, bounded mock model probing, opt-in sanitized trace recording, real-trace import and independent objective scoring. CI is **offline**. Never misrepresent mock route accuracy as live Gemini accuracy.

The catalog and fixture counts evolve. At this revision there are 56 declared functions and 81 scenarios (54 base / 20 disambiguation / 7 no-tool). **These are descriptive, not constants to maintain blindly.** Determine the current numbers from the declarations and the fixtures every time.

## Tool lifecycle — mandatory in a single PR

| Change | Required work |
| --- | --- |
| Add a tool | Add Live declaration/name/schema/description, `decideToolCall` typed validation/route, actual `AssistantController` + platform/service executor, approval/auto-run behavior, tool intelligence entry, base eval scenario, argument/permission/success/error tests |
| Remove or rename a tool | Remove/migrate all of the above, clean old playbook/context/result/fixture references, update affected consumers and history compatibility; do not leave a declared dead route or an unregistered reference |
| Change argument schema | Update declaration AND validation AND executor, negative-case tests, any affected `ConfirmToolName`, consumer payloads, playbooks and fixtures; preserve intentional backward compatibility |
| Change semantics, side effects or permissions | Review and test confirmation, cancellation, retry behavior, end-state observation, failure classification, platform capabilities, prompt/tool descriptions and golden scenarios; preserve current user-controlled approvals |
| Change platform/provider support | Update platform adapters and checks, tool registry platform, `contextAssembler` device guidance, on-demand procedures, platform-specific tests; never claim an Android-local Windows action |
| Change routing or selection guidance only | Update `toolIntelligence`, overlapping playbooks/context assembler and ambiguity/no-tool fixtures; test that a simple command does not trigger extra planning |
| Change result/verification/recovery | Update `toolResults`, controller response tests, trace/status interpretations, offline corpus and real-observation criteria where needed; don't claim task completion from ACK alone |
| Add a workflow/playbook | Update `playbooks/index.ts`, its allowlisted ID/tool declaration, `contextAssembler` and guidance, tests/fixtures; restrict to genuine multi-tool patterns, bounded results and no auto-execution |

When the tool name stays the same, **semantic changes still require this checklist**. Scan all existing references with a repository-wide search (e.g. `rg 'tool_name' src docs`), including `src/assistant/tools.test.ts`, `AssistantController.test.ts`, `protocol.test.ts`, individual playbooks, `toolResults.test.ts` and `contextAssembler.test.ts`.

## Required evaluations and drift protection

- `assistantFunctionDeclarations()` names MUST exactly match entries in `ASSISTANT_TOOL_INTELLIGENCE`.
- Every declared tool MUST have exactly one `tool-<name>` base scenario in `evals/fixtures.ts` with an independently checkable `successCriterion`. An expected tool sequence is **not** a live performance measurement.
- `decideToolCall()` MUST explicitly recognize and validate each declared tool. Unknown calls must reject safely; they must not silently execute.
- Every tool referenced by a playbook MUST exist in the Live declarations and registry. Review other text references in `ASSISTANT_TOOL_SELECTION_GUIDANCE`, `ASSISTANT_PLAYBOOK_GUIDANCE`, `contextAssembler` and `toolResults` manually when a tool is removed/renamed.
- Use `pnpm check` + `pnpm eval:tools`. `evals/toolCatalogParity.test.ts` automatically checks catalog/router/profile/fixture parity, including additions and removals. Do **not** weaken parity assertions to silence a failing PR; fix the missing component.
- Keep a targeted test for malformed arguments, platform mismatch, cancellation, successful action and independently observed effect for every changed tool. Where applicable, add a choice case distinguishing it from the closest competing tool.
- Run Windows + Android CI. On-device manual smoke tests must cover the changed behavior, not merely starting the app. When outcomes require real evidence, use the opt-in development tool trace capture described in `docs/Assistant-Phases/20-tool-use-evaluation-framework.md` and verify the task state separately.
- When the tool catalog changes, review **all hard-coded counts** in test names, docs and performance reporting. Prefer assertions derived from the actual declaration/fixture set, with one-to-one drift checking, over fragile pinned totals.

## Don't do these things

- Don't change existing tool approvals, permission checks, or command allowlists just to make the harness pass tests.
- Don't add an extra model/planner call to every voice interaction or inject all playbooks into every session.
- Don't guess a successful action based on a returned `ok`; separate command acknowledgment from verified end state.
- Don't copy or persist user prompts, function arguments, memory contents, images, tokens or raw tool outputs in evaluation traces; real capture must remain explicit opt-in.
- Don't hide an unsupported/retired tool by removing its test instead of cleaning all relevant code, guidance, and workflows.
- Don't report mocked/scripted evaluation scores as actual model performance.

## PR completion checklist

- [ ] Declarations, schema validation, typed decisions, executor and approval semantics agree.
- [ ] Every changed tool has an up-to-date registry entry and no stale playbook/context references.
- [ ] Result/evidence classification and recovery are accurate, with negative tests.
- [ ] Golden scenario added/edited/retired; disambiguation and no-tool regressions reviewed.
- [ ] `pnpm check`, `pnpm eval:tools` and Windows/Android CI pass.
- [ ] PR summary includes concise implementation notes, **3–5 manual tests with expected results**, actual CI status and merge readiness.
