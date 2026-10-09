import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseEvalTraces } from "@/assistant/harness/evals/traceImport";
import { evaluateBatch, checkRegression } from "@/assistant/harness/evals/evaluate";

/**
 * Optional real-trace scoring. Does NOT contact Gemini or execute tools.
 * ASSISTANT_EVAL_TRACE_FILE must point to a sanitized JSON array created
 * from explicit opt-in evaluation captures.
 */
const inputPath = process.env.ASSISTANT_EVAL_TRACE_FILE;
describe("optional imported model/tool traces", () => {
  it.skipIf(!inputPath)("reports actual recorded samples with explicit sample sizes and optional threshold", () => {
    const raw = readFileSync(inputPath!, "utf8");
    if (raw.length > 500_000) throw new Error("Evaluation trace file is too large.");
    const traces = parseEvalTraces(JSON.parse(raw) as unknown);
    const report = evaluateBatch(traces, "imported-opt-in-tool-traces");
    console.info("ASSISTANT_EVAL_IMPORTED_REPORT " + JSON.stringify({
      label: report.label,
      samples: report.overall.samples,
      byModality: report.byModality,
      byPlatform: report.byPlatform,
      byOrigin: report.byOrigin,
      liveModel: report.liveModel,
      coverage: report.scenarioCoverage,
      pathRate: report.overall.rates.pathAccuracy,
      verifiedGoalSamples: report.overall.independentlyVerifiedGoals,
      verifiedGoalRate: report.overall.rates.independentlyVerifiedGoalRate,
      warnings: report.warnings,
      failedCases: report.cases.filter((row) => !row.selection.toolPathPassed).map((row) => row.scenarioId),
    }));
    const min = process.env.ASSISTANT_EVAL_MIN_PATH_RATE;
    if (min !== undefined) {
      const gate = checkRegression(report, { minPathRate: Number(min) });
      expect(gate.failures, gate.failures.join("; ")).toEqual([]);
    }
    const goalMin = process.env.ASSISTANT_EVAL_MIN_VERIFIED_GOAL_RATE;
    if (goalMin !== undefined) {
      const gate = checkRegression(report, {
        minVerifiedGoalRate: Number(goalMin),
        minVerifiedGoalSamples: 1,
      });
      expect(gate.failures, gate.failures.join("; ")).toEqual([]);
    }
  });
});
