import { TOOL_SELECTION_SCENARIOS } from "@/assistant/harness/evals/fixtures";
import { scoreToolTrace, type ToolSelectionScenario, type ToolTraceScore } from "@/assistant/harness/evals/traceScore";
import type { ToolEvalAttempt, ToolEvalTrace, EvalModality, EvalPlatform, EvalOrigin } from "@/assistant/harness/evals/traceRecorder";

export interface EvaluatedTrace {
  readonly scenarioId: string;
  readonly origin: ToolEvalTrace["origin"];
  readonly modality: EvalModality;
  readonly platform: EvalPlatform;
  readonly selection: ToolTraceScore;
  readonly observedGoal: boolean | null;
  readonly goalEvidenceSource: ToolEvalTrace["goal"]["source"];
  readonly toolErrors: number;
  readonly pendingCalls: number;
  /** Repeating the same failed call without an intervening inspection/new evidence. */
  readonly unexaminedRepeats: number;
  readonly playbookLookups: number;
  /** Extra lookup for a simple single/no-tool scenario. */
  readonly avoidableLookups: number;
  readonly firstCallMs: number | null;
  readonly lastResultMs: number | null;
}

export interface MetricRates {
  /** null if denominator is zero; no fabricated sample sizes. */
  readonly pathAccuracy: number | null;
  readonly independentlyVerifiedGoalRate: number | null;
  readonly avoidableLookupRate: number | null;
  readonly repeatedFailureRate: number | null;
}
export interface EvalCohort {
  readonly samples: number;
  readonly passedPaths: number;
  readonly independentlyVerifiedGoals: number;
  readonly passedGoals: number;
  readonly failedGoals: number;
  readonly unknownGoals: number;
  readonly unnecessaryLookups: number;
  readonly repeatedFailures: number;
  readonly toolErrors: number;
  readonly rates: MetricRates;
}
export interface EvalReport {
  readonly label: string;
  readonly scenarioCount: number;
  readonly scenarioCoverage: number;
  readonly overall: EvalCohort;
  readonly byModality: Readonly<Record<EvalModality, EvalCohort>>;
  readonly byPlatform: Readonly<Record<EvalPlatform, EvalCohort>>;
  readonly byOrigin: Readonly<Record<EvalOrigin, EvalCohort>>;
  /** Only explicitly labeled real Live captures, never simulated or unproven imports. */
  readonly liveModel: EvalCohort;
  readonly cases: readonly EvaluatedTrace[];
  readonly warnings: readonly string[];
}

const KNOWN = new Map(TOOL_SELECTION_SCENARIOS.map((scenario) => [scenario.id, scenario]));
const recoveryFailure = (attempt: ToolEvalAttempt): boolean =>
  attempt.status === "failed" || attempt.status === "cancelled" || attempt.status === "blocked" || attempt.status === "incomplete";

function countUnexaminedRepeats(attempts: readonly ToolEvalAttempt[]): number {
  let count = 0;
  for (let i = 1; i < attempts.length; i += 1) {
    const prev = attempts[i - 1];
    const current = attempts[i];
    if (prev && current && prev.tool === current.tool && recoveryFailure(prev)) count += 1;
  }
  return count;
}

/**
 * An observed task outcome is independent of the tool path.
 * An erroneous tool path can still reach the goal, and a correct path can fail.
 */
export function evaluateTrace(trace: ToolEvalTrace, scenario: ToolSelectionScenario): EvaluatedTrace {
  if (trace.scenarioId !== scenario.id) throw new Error("Trace scenario does not match the evaluation fixture.");
  if (trace.goal.source === "unverified" && trace.goal.passed !== null)
    throw new Error("Unverified outcome cannot claim the goal was achieved.");
  if (trace.goal.source !== "unverified" && trace.goal.passed === null)
    throw new Error("Verified outcome requires a boolean observation.");
  if (trace.origin === "live" && trace.goal.source === "mock")
    throw new Error("Mock evidence cannot verify a live task.");
  const selected = trace.attempts.map((attempt) => attempt.tool);
  const selection = scoreToolTrace(scenario, selected);
  const firstCallMs = trace.attempts[0]?.startMs ?? null;
  const observed = trace.attempts.filter((attempt) => attempt.durationMs !== null);
  const lastResultMs = observed.length
    ? Math.max(...observed.map((attempt) => attempt.startMs + (attempt.durationMs ?? 0))) : null;
  const playbookLookups = selected.filter((name) => name === "get_tool_playbook").length;
  return {
    scenarioId: trace.scenarioId,
    origin: trace.origin,
    modality: trace.modality,
    platform: trace.platform,
    selection,
    observedGoal: trace.goal.passed,
    goalEvidenceSource: trace.goal.source,
    toolErrors: trace.attempts.filter(recoveryFailure).length,
    pendingCalls: trace.attempts.filter((attempt) => attempt.status === "pending").length,
    unexaminedRepeats: countUnexaminedRepeats(trace.attempts),
    playbookLookups,
    avoidableLookups: scenario.expected.length <= 1 && !scenario.expected.includes("get_tool_playbook")
      && !(scenario.optional ?? []).includes("get_tool_playbook")
      ? playbookLookups : 0,
    firstCallMs,
    lastResultMs,
  };
}

function rate(top: number, bottom: number): number | null {
  return bottom ? Math.round((top / bottom) * 10_000) / 10_000 : null;
}

function cohort(cases: readonly EvaluatedTrace[]): EvalCohort {
  const passedPaths = cases.filter((row) => row.selection.toolPathPassed).length;
  const verified = cases.filter((row) => row.observedGoal !== null);
  const passedGoals = verified.filter((row) => row.observedGoal === true).length;
  const failedGoals = verified.length - passedGoals;
  const unnecessaryLookups = cases.reduce((sum, row) => sum + row.avoidableLookups, 0);
  const repeatedFailures = cases.reduce((sum, row) => sum + row.unexaminedRepeats, 0);
  const toolErrors = cases.reduce((sum, row) => sum + row.toolErrors, 0);
  const totalCalls = cases.reduce((sum, row) => sum + row.selection.selected.length, 0);
  return {
    samples: cases.length, passedPaths, independentlyVerifiedGoals: verified.length,
    passedGoals, failedGoals, unknownGoals: cases.length - verified.length,
    unnecessaryLookups, repeatedFailures, toolErrors,
    rates: {
      pathAccuracy: rate(passedPaths, cases.length),
      independentlyVerifiedGoalRate: rate(passedGoals, verified.length),
      avoidableLookupRate: rate(unnecessaryLookups, totalCalls),
      repeatedFailureRate: rate(repeatedFailures, totalCalls),
    },
  };
}

export function evaluateBatch(traces: readonly ToolEvalTrace[], label = "unlabeled"): EvalReport {
  const cases = traces.map((trace) => {
    const scenario = KNOWN.get(trace.scenarioId);
    if (!scenario) throw new Error(`Unknown scenario ID: ${trace.scenarioId}`);
    return evaluateTrace(trace, scenario);
  });
  // Multiple trials of the same scenario are necessary for a meaningful sample rate.
  const included = new Set(cases.map((row) => row.scenarioId));
  const liveCount = cases.filter((row) => row.origin === "live").length;
  const distinctOrigins = new Set(cases.map((row) => row.origin));
  return {
    label,
    scenarioCount: TOOL_SELECTION_SCENARIOS.length,
    scenarioCoverage: rate(included.size, TOOL_SELECTION_SCENARIOS.length) ?? 0,
    overall: cohort(cases),
    byModality: {
      typed: cohort(cases.filter((row) => row.modality === "typed")),
      voice: cohort(cases.filter((row) => row.modality === "voice")),
      unknown: cohort(cases.filter((row) => row.modality === "unknown")),
    },
    byPlatform: {
      windows: cohort(cases.filter((row) => row.platform === "windows")),
      android: cohort(cases.filter((row) => row.platform === "android")),
      unknown: cohort(cases.filter((row) => row.platform === "unknown")),
    },
    byOrigin: {
      live: cohort(cases.filter((row) => row.origin === "live")),
      fixture: cohort(cases.filter((row) => row.origin === "fixture")),
      mock: cohort(cases.filter((row) => row.origin === "mock")),
      imported: cohort(cases.filter((row) => row.origin === "imported")),
    },
    liveModel: cohort(cases.filter((row) => row.origin === "live")),
    cases,
    warnings: [
      ...(liveCount === 0 ? ["No recorded real-model traces. Synthetic/mocked results are NOT model accuracy."] : []),
      ...(distinctOrigins.size > 1 ? ["Mixed trace origins: use byOrigin or liveModel cohorts, not pooled rates, for model-quality claims."] : []),
      ...(cases.some((row) => row.origin === "imported") ? ["Imported traces have unconfirmed origin; do not automatically count them as verified Live-model samples."] : []),
      ...(cases.some((row) => row.observedGoal === null) ? ["Some tasks have no independently observed end state; exclude them from verified goal rate."] : []),
      ...(cases.some((row) => row.pendingCalls > 0) ? ["Some tool calls have no completed function response; examine trace capture/session completion."] : []),
    ],
  };
}

export interface RegressionGate {
  readonly minPathRate?: number;
  readonly minVerifiedGoalRate?: number;
  readonly minVerifiedGoalSamples?: number;
  readonly maxAvoidableLookupRate?: number;
  readonly maxRepeatedFailureRate?: number;
}

export interface GateResult {
  readonly passed: boolean;
  readonly failures: readonly string[];
}

/** Optional explicit regression thresholds; do not silently pass an unmeasured metric. */
export function checkRegression(report: EvalReport, gate: RegressionGate): GateResult {
  const checks: [string, number | null, number | undefined, "min" | "max"][] = [
    ["pathAccuracy", report.overall.rates.pathAccuracy, gate.minPathRate, "min"],
    ["verifiedGoalRate", report.overall.rates.independentlyVerifiedGoalRate, gate.minVerifiedGoalRate, "min"],
    ["avoidableLookupRate", report.overall.rates.avoidableLookupRate, gate.maxAvoidableLookupRate, "max"],
    ["repeatedFailureRate", report.overall.rates.repeatedFailureRate, gate.maxRepeatedFailureRate, "max"],
  ];
  const failures = checks.flatMap(([name, actual, threshold, direction]) => {
    if (threshold === undefined) return [];
    if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1)
      throw new Error(`Invalid regression threshold: ${name}`);
    if (actual === null) return [`${name}: no observations (gate cannot pass)`];
    return direction === "min" ? actual < threshold ? [`${name}: ${actual} < ${threshold}`] : []
      : actual > threshold ? [`${name}: ${actual} > ${threshold}`] : [];
  });
  const origins = new Set(report.cases.map((row) => row.origin));
  const hasThresholds = checks.some(([, , threshold]) => threshold !== undefined)
    || gate.minVerifiedGoalSamples !== undefined;
  if (origins.size > 1 && hasThresholds) {
    failures.push("Mixed trace origins cannot be regression-gated together; evaluate each origin separately.");
  }
  if (gate.minVerifiedGoalSamples !== undefined) {
    if (!Number.isInteger(gate.minVerifiedGoalSamples) || gate.minVerifiedGoalSamples < 1)
      throw new Error("minVerifiedGoalSamples must be a positive integer.");
    if (report.overall.independentlyVerifiedGoals < gate.minVerifiedGoalSamples)
      failures.push(`verifiedGoalSamples: ${report.overall.independentlyVerifiedGoals} < ${gate.minVerifiedGoalSamples}`);
  }
  return { passed: failures.length === 0, failures };
}
