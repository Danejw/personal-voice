import { describe, expect, it } from "vitest";
import { evaluateBatch, evaluateTrace, checkRegression } from "@/assistant/harness/evals/evaluate";
import { TOOL_SELECTION_SCENARIOS } from "@/assistant/harness/evals/fixtures";
import { SCRIPTED_REGRESSION_CORPUS } from "@/assistant/harness/evals/mockCorpus";

describe("independent tool-use regression corpus", () => {
  const report = evaluateBatch(SCRIPTED_REGRESSION_CORPUS, "scripted-offline-not-model-quality");

  it("scores hardcoded candidate paths instead of grading expected routes against themselves", () => {
    expect(report.overall.samples).toBe(13);
    expect(report.byOrigin.mock.samples).toBe(13);
    expect(report.liveModel.samples).toBe(0);
    expect(report.overall.passedPaths).toBe(9);
    expect(report.overall.independentlyVerifiedGoals).toBe(12);
    expect(report.overall.passedGoals).toBe(7);
    expect(report.overall.failedGoals).toBe(5);
    expect(report.overall.unknownGoals).toBe(1);
    expect(report.overall.unnecessaryLookups).toBe(1);
    expect(report.overall.repeatedFailures).toBe(1);
    expect(report.overall.toolErrors).toBe(3);
    expect(report.overall.rates.pathAccuracy).toBe(0.6923);
    expect(report.overall.rates.independentlyVerifiedGoalRate).toBe(0.5833);
    expect(report.overall.rates.avoidableLookupRate).toBe(0.0667);
    expect(report.warnings).toContain("No recorded real-model traces. Synthetic/mocked results are NOT model accuracy.");
    expect(report.scenarioCount).toBe(TOOL_SELECTION_SCENARIOS.length);
    expect(report.scenarioCoverage).toBe(Number((13 / TOOL_SELECTION_SCENARIOS.length).toFixed(4)));
    expect(report.byModality.voice.samples).toBe(5);
    expect(report.byPlatform.android.samples).toBe(6);
  });

  it("reports correct tool path even when an independent screen task fails", () => {
    const screen = report.cases.find((row) => row.scenarioId === "tool-supervise_screen");
    expect(screen?.selection.toolPathPassed).toBe(true);
    expect(screen?.observedGoal).toBe(false);
    expect(screen?.toolErrors).toBe(1);
    expect(screen?.firstCallMs).toBe(40);
    expect(screen?.lastResultMs).toBe(70);
  });

  it("identifies accidental playbook lookups and repeating a failed tool", () => {
    expect(report.cases.find((row) => row.scenarioId === "none-chat-only")).toMatchObject({
      playbookLookups: 1, avoidableLookups: 1,
    });
    expect(report.cases.find((row) => row.scenarioId === "tool-create_note")).toMatchObject({
      unexaminedRepeats: 1, toolErrors: 2,
    });
  });

  it("enforces explicit gates only against actually observed denominators", () => {
    expect(checkRegression(report, {
      minPathRate: 0.69, minVerifiedGoalRate: 0.58,
      minVerifiedGoalSamples: 12, maxAvoidableLookupRate: 0.07,
      maxRepeatedFailureRate: 0.07,
    })).toEqual({ passed: true, failures: [] });
    const gate = checkRegression(report, { minPathRate: 0.90, maxRepeatedFailureRate: 0.01 });
    expect(gate.passed).toBe(false);
    expect(gate.failures).toHaveLength(2);
    const empty = evaluateBatch([]);
    expect(empty.overall.rates.pathAccuracy).toBeNull();
    expect(empty.overall.rates.independentlyVerifiedGoalRate).toBeNull();
    expect(checkRegression(empty, { minPathRate: 0.01 }).passed).toBe(false);
    expect(checkRegression(empty, { minVerifiedGoalRate: 0.50 }).passed).toBe(false);
  });

  it("rejects fabricated goal verification, unknown scenarios and duplicate cases", () => {
    const scenario = TOOL_SELECTION_SCENARIOS.find((item) => item.id === "choice-pointer-over-screen");
    if (!scenario) throw new Error("Fixture missing.");
    const good = SCRIPTED_REGRESSION_CORPUS[0]!;
    expect(() => evaluateTrace({ ...good, goal: { passed: true, source: "unverified" } }, scenario)).toThrow();
    expect(() => evaluateTrace({ ...good, origin: "live", goal: { passed: true, source: "mock" } }, scenario)).toThrow();
    expect(() => evaluateBatch([{ ...good, scenarioId: "nonexistent" }])).toThrow();
    const repeated = evaluateBatch([good, good]);
    expect(repeated.overall.samples).toBe(2);
    expect(repeated.scenarioCoverage).toBe(Number((1 / TOOL_SELECTION_SCENARIOS.length).toFixed(4)));
    const mixed = evaluateBatch([good, { ...good, origin: "live", goal: { passed: null, source: "unverified" } }]);
    expect(mixed.liveModel.samples).toBe(1);
    expect(mixed.warnings.some((warning) => warning.includes("Mixed trace origins"))).toBe(true);
    expect(checkRegression(mixed, { minPathRate: 0.5 }).passed).toBe(false);
    expect(() => evaluateTrace(good, TOOL_SELECTION_SCENARIOS[1]!)).toThrow();
  });

  it("labels offline results as synthetic and prints a readable regression score summary", () => {
    const summary = {
      label: report.label,
      origin: "scripted mock regression, NOT real Gemini accuracy",
      cases: report.overall.samples,
      pathPass: report.overall.passedPaths,
      independentGoalChecks: report.overall.independentlyVerifiedGoals,
      goalPass: report.overall.passedGoals,
      pathRate: report.overall.rates.pathAccuracy,
      goalRateOnMockObservations: report.overall.rates.independentlyVerifiedGoalRate,
      unnecessaryLookups: report.overall.unnecessaryLookups,
      blindRetries: report.overall.repeatedFailures,
    };
    expect(summary.pathRate).not.toBeNull();
    console.info("ASSISTANT_EVAL_OFFLINE_SUMMARY " + JSON.stringify(summary));
  });
});
