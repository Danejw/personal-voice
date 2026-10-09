# PR26 — Full Tool-Use Evaluation and Regression Framework

**Baseline:** merged PR25 on `main` at `31064ecc3a5b9bad215890241e757b6e41219140`. Built on the 54-tool registry, seven playbooks, result intelligence and platform context.

## What ships

1. **81 real test *definitions***: one per current tool (54), 20 tool-choice disambiguation cases and seven no-tool requests. Their `successCriterion` describes an independently observable end state. A scenario definition alone is not a result.
2. **Opt-in tool trace capture** from the actual Gemini Live `AssistantController`: tool *names*, relative start/elapsed milliseconds, completion statuses and normalized failure categories. Never records user requests, tool arguments, model messages, audio, screen pixels, tokens, account IDs or response text; no persistence, telemetry or network requests.
3. **Independent evaluation engine**: scores first-tool choice, full ordered path, omitted/wrong/unnecessary calls, playbook overhead, repeated unsuccessful attempts, unknown tool use, incomplete results, typed vs voice and Android vs Windows cohorts. Calculates the model selection rate separately from the final goal's **independently verified** rate, and reports `null` for an unmeasured rate.
4. **Scripted model/mock-executor regression harness**: bounded steps (up to 20), 12-tool batch max and 32 total calls, with an externally injected provider. CI uses deterministic scripted probes only. No default Gemini/API/model calls, permissions, credits or real device effects.
5. **Independent 13-case scripted corpus** mixing correct choices, known mistakes, unnecessary playbook lookup, failed action, repeated failure and a task with correct tool path but incomplete goal. Tests enforce measured offline *fixture mechanics*, **never a claim of live Gemini quality**.
6. **Strict sanitized JSON importer** plus optional rate/sample regression gates. Invalid/misleading evidence, unexpected text fields, oversized traces and bogus samples are rejected.
7. **Developer-only in-app capture hook**: `window.__pvToolEval` exists in development builds only. No production logging or UI changes. Actual traces can be tagged with independently observed goal success and evaluated offline.

## CI / commands

On Windows (PowerShell), from repository root:

```powershell
pnpm check
pnpm eval:tools
```

`pnpm eval:tools` runs only `src/assistant/harness/evals` tests and prints `ASSISTANT_EVAL_OFFLINE_SUMMARY` with an explicit scripted/mock source label. `validate.yml` runs the offline regression after `pnpm check` on Windows, in addition to existing Rust and Android validation.

There are **no paid/live model requests in CI**. The scripted corpus's accuracy is **not** model accuracy.

## Capture a real Live tool-choice trace (development builds)

Open the application's JavaScript developer console (Windows Tauri dev; Android WebView inspector as appropriate). In the installed release build the debug hook is deliberately absent.

1. Begin an explicit evaluation case:

```javascript
window.__pvToolEval.begin("choice-copy-v-insert", "typed");
```

2. Ask the assistant: **"Copy these words but do not type anything."** Allow the tool call to finish, then check the actual clipboard and whether the focused field changed.
3. Export the sanitized trace. The end-state is **manual evidence**, not inferred from the tool's acknowledgement:

```javascript
const result = window.__pvToolEval.finish();
result.goal = { passed: true, source: "manual" }; // ONLY if clipboard was actually checked
console.log(JSON.stringify([result], null, 2));
```

Copy the JSON into `tool-eval-traces.json` locally (do not commit personal evaluations). If you could not independently verify the outcome, **leave `goal: { passed: null, source: "unverified" }`**. To abandon capture call `window.__pvToolEval.cancel()`.

To score the recorded run without any model call:

```powershell
$env:ASSISTANT_EVAL_TRACE_FILE = "./tool-eval-traces.json"
pnpm eval:tools
Remove-Item Env:ASSISTANT_EVAL_TRACE_FILE
```

Optional threshold, only when you have a meaningful sample:

```powershell
$env:ASSISTANT_EVAL_TRACE_FILE = "./tool-eval-traces.json"
$env:ASSISTANT_EVAL_MIN_PATH_RATE = "0.90"
pnpm eval:tools
Remove-Item Env:ASSISTANT_EVAL_TRACE_FILE
Remove-Item Env:ASSISTANT_EVAL_MIN_PATH_RATE
```

Optionally set `ASSISTANT_EVAL_MIN_VERIFIED_GOAL_RATE` after real manual/device observations. Thresholds **fail** when the required metric has no observations. The CLI emits a cohort breakdown, coverage, failed case IDs, sample counts and warnings. Do not mix mocked and real traces when reporting real accuracy; label and filter the sample population clearly.

## How to interpret metrics

| Metric | Meaning |
| --- | --- |
| Tool-path accuracy | Model's actual tool names/order vs the scenario's expected path, on the recorded sample |
| Independently verified goal rate | Human/device-observed task completion; unknowns excluded from denominator |
| Unnecessary lookup rate | Extra `get_tool_playbook` calls for simple/no-tool requests |
| Unexamined failure repeat rate | Immediate same-tool retry following a failed, blocked, cancelled or incomplete result without another evidence-gathering call |
| First-tool latency | Milliseconds from explicit capture start to first tool call, not necessarily total spoken response latency |
| Platform/modality cohorts | Windows / Android, typed / voice / unknown; never pool them without their sample sizes |
| Coverage | Unique scenario IDs recorded divided by the 81 defined scenarios |

**Multiple trials:** You may record repeated attempts of the same scenario, platform and modality. They count as separate samples, but unique scenario coverage counts each scenario once. Reports explicitly separate `liveModel` and `byOrigin` cohorts; a mixture of mocks and real-model traces cannot pass a single pooled regression gate. Imported traces of unknown provenance are not assumed to be real model runs.\n\n**Limitations:** A correct tool path is not the same as successful task completion; a viable alternate sequence might need an allowed path added to fixtures. Voice calls may not include the same typed task hints as PR25. The offline corpus is a deliberately synthetic regression of evaluation behavior, not an LLM benchmark.

## Quick manual smoke tests

1. **Simple command, no extra planning:** Ask to copy a short phrase. Confirm clipboard contents; the assistant should use `copy_text`, not insert or load a playbook.
2. **Ambiguous visual choice:** Point to a button in Windows and ask "What is this?" Expect `inspect_pointer_context`, with a marked capture only if needed.
3. **Memory vs thread continuation:** Ask to read an older conversation without switching. Expect `list_past_conversations` then `read_past_conversation`; confirm active conversation remains unchanged.
4. **Failure recovery:** Deliberately request an unavailable remote target; expect honest error reporting and no unexamined blind repetition.
5. **Evaluate:** Run `pnpm eval:tools`, then capture one real scenario via the development-only hook. Import its JSON and confirm the report distinguishes model tool-path success from your actual observed outcome.

## Next decisions

Compare multiple **real** Windows and Android spoken/typed traces to these known scenario definitions, expand permitted alternative routes where justified, and set regression thresholds **only after a measured, representative baseline exists**. Do not claim aspirational 95% tool correctness or 90% goal completion as actual numbers until independently observed.
