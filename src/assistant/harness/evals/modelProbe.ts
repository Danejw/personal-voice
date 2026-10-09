import { interpretToolResult } from "@/assistant/harness/toolResults";
import { TOOL_SELECTION_SCENARIOS } from "@/assistant/harness/evals/fixtures";
import { ToolTraceRecorder, type ToolEvalTrace, type TraceMetadata } from "@/assistant/harness/evals/traceRecorder";

/**
 * Pluggable probe. A real Gemini adapter is optional and must be explicitly
 * supplied by the caller; default CI uses a local scripted probe only.
 */
export interface ModelProbe {
  propose(input: {
    scenarioId: string;
    request: string;
    steps: readonly { tool: string; ok: boolean }[];
  }): Promise<{
    calls: readonly { id: string; name: string }[];
    done?: boolean;
  }>;
}

/** The fixture executor never touches an app, account, network or real user data. */
export interface ToolEvalExecutor {
  execute(name: string): Promise<{ ok: boolean; message: string }>;
}

export interface EvalRunOptions {
  readonly metadata: Omit<TraceMetadata, "origin"> & { origin?: "mock" | "live" };
  readonly maxSteps?: number;
  readonly now?: () => number;
}

export async function runModelEval(
  probe: ModelProbe,
  executor: ToolEvalExecutor,
  options: EvalRunOptions,
): Promise<ToolEvalTrace> {
  const scenario = TOOL_SELECTION_SCENARIOS.find((item) => item.id === options.metadata.scenarioId);
  if (!scenario) throw new Error("Unknown evaluation fixture.");
  const maxSteps = options.maxSteps ?? 12;
  if (!Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > 20)
    throw new Error("Model eval step limit must be 1..20.");
  const recorder = new ToolTraceRecorder({ ...options.metadata, origin: options.metadata.origin ?? "mock" }, options.now);
  const toolHistory: { tool: string; ok: boolean }[] = [];
  for (let step = 0; step < maxSteps; step += 1) {
    const proposal = await probe.propose({
      scenarioId: scenario.id, request: scenario.request, steps: [...toolHistory],
    });
    if (proposal.done || proposal.calls.length === 0) return recorder.snapshot();
    // One bounded tool batch; never execute unbounded model requests.
    if (proposal.calls.length > 12) throw new Error("Model proposed too many tools in one step.");
    recorder.noteCalls(proposal.calls);
    for (const call of proposal.calls) {
      const { ok, message } = await executor.execute(call.name);
      const assessment = interpretToolResult(call.name, ok, message);
      recorder.noteResult(call.id, assessment);
      toolHistory.push({ tool: call.name, ok });
    }
    if (toolHistory.length >= 32) throw new Error("Evaluation run exceeded 32 tool calls.");
  }
  throw new Error("Model eval reached the bounded step limit without completion.");
}

/** Scripted probe for deterministic regression tests, NOT measured LLM quality. */
export function scriptedProbe(batches: readonly (readonly string[])[]): ModelProbe {
  let cursor = 0;
  return {
    propose: async () => {
      const batch = batches[cursor++] ?? [];
      return { calls: batch.map((name, index) => ({ name, id: `mock-${cursor}-${index}` })), done: batch.length === 0 };
    },
  };
}
