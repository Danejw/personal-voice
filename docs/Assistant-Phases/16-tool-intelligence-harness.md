# Assistant Tool Intelligence Harness — PR22

**Base:** `main` at `2030201245a1157d6c4c811492bda5e4d3d47282`.

## Goal

Improve Gemini 3.8 Live's ability to choose the correct existing tool, avoid a superficially similar but incorrect tool, and choose sensible next steps. This is the first incremental harness PR, not a new agent framework.

## What this PR does

- Adds `src/assistant/harness/toolIntelligence.ts`: a structured profile for each of the **53** Live-declared tools. Every profile records family, platform, when to use, when not to use, what to do next, and how to verify the result.
- Adds **short selection hints** to existing Live tool descriptions where overlap is most likely to confuse the model. Existing tool names, parameter schemas, and descriptions are preserved and extended rather than replaced.
- Adds a short tool-selection strategy to the existing Live system instruction. No extra model call, no dynamic tools or session churn.
- Adds 80 explicit tool-path scenarios: one for each existing tool, 20 disambiguation cases, and seven no-tool cases.
- Adds a deterministic trace scorer that checks first-tool choice, required order, missing/forbidden/extra/unknown tools, and optional verified outcome.
- Adds drift tests: changes to the declared tool list must be reflected in registry coverage and scenario fixtures.

## Non-goals / invariants

- Do **not** change the existing permission policy, confirmation cards, `decideToolCall` validation, execution allowlist, or computer step loop.
- Do **not** change Live model selection, wire formats, session resumption, microphone behavior, Supabase services, or Tauri commands.
- Do **not** introduce another LLM or a per-turn planning call.
- Do **not** attempt model-driven playbooks, dynamic capability filtering, automatic retries, or result verification yet. Those are separate follow-up PRs.
- Never present a successful tool response as proof that the objective was achieved. The new trace scorer explicitly separates tool-path pass from real objective verification.

## Key tool-selection distinctions

| User intent | First tool / strategy | Avoid confusing with |
| --- | --- | --- |
| "What's this under my mouse?" | `inspect_pointer_context` | generic screenshot |
| Pointed graphic not accessible | inspect pointer then `capture_pointer_target` | assuming accessibility text is enough |
| See the whole screen | `capture_screen` | camera photo |
| Precisely target a Windows control | `inspect_accessibility_tree` then `accessibility_pattern_action` | visual multi-step computer agent |
| Multi-step visual task | `supervise_screen` | one-off UIA control |
| Search what was saved | `search_memory` | enumerate saved conversation threads |
| List / browse old conversations | `list_past_conversations` | general memory search |
| Read an old thread without switching | list, then `read_past_conversation` | continuing old thread |
| Resume exact prior thread | list, then `continue_past_conversation` | read-only historical lookup |
| Copy text | `copy_text` | active-field insertion |
| Paste into this device | `insert_text` | cross-device handoff |
| Leave text for another device | `send_handoff` | remote focused-field insertion |
| Type on another device | `send_remote_dictation` | inbox handoff |

## Evaluation and validation

Run the existing checks:

```bash
pnpm check
```

The harness-specific tests are included in Vitest:

```bash
pnpm exec vitest run src/assistant/harness/evals/traceScore.test.ts
```

### What the 80 tests mean

These **golden fixtures** describe expected valid tool paths. Running the scorer against its own expected traces tests the fixture definitions, scorer, registry parity, and regressions; it is **not** a measured model success rate.

A trustworthy baseline still requires a live, explicitly authorized Gemini evaluation with recorded selected tools, mocked or test-account side effects, and an observable end-state check. That will be developed in PR26. We should not report accuracy percentages before that live baseline exists.

### Manual checks

1. Verify local / remote pointer references lead to pointer inspection, not an unrelated screenshot.
2. Ask to view, summarize, and resume an old conversation separately; verify each uses its corresponding tool.
3. Confirm handoffs and remote dictation are not confused.
4. Check a simple arithmetic or writing request is answered without app tools.
5. Confirm Windows / Android dictation, camera, note actions, and cross-device behavior are unchanged.

## Next PRs

- **PR23 — Tool Playbooks:** reusable task procedures and lazy retrieval for complex operations.
- **PR24 — Result Intelligence:** structured results, completion checks, and bounded recovery guidance.
- **PR25 — Context-Aware Tool Guidance:** inject relevant playbooks and device capabilities at task boundaries.
- **PR26 — Evals:** instrument real tool traces, run live model trials, score verified end states, compare against this baseline.
