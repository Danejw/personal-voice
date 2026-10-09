import { toolIntelligence, type AssistantToolName } from "@/assistant/harness/toolIntelligence";

/** Expected tool sequence for an example user request. No Gemini calls are made here. */
export interface ToolSelectionScenario {
  readonly id: string;
  readonly request: string;
  /** Required tools in the expected order. Alternative paths can be added as separate scenarios. */
  readonly expected: readonly AssistantToolName[];
  /** Allow other valid first steps where more than one discovery tool is appropriate. */
  readonly firstAnyOf?: readonly AssistantToolName[];
  /** Permitted additional steps (e.g. verification) that do not count as waste. */
  readonly optional?: readonly AssistantToolName[];
  /** Known wrong tools for this intent. */
  readonly forbidden?: readonly AssistantToolName[];
  /** Human/end-state checker criterion, not asserted by this deterministic scorer. */
  readonly successCriterion: string;
}

export interface ToolTraceScore {
  readonly scenarioId: string;
  readonly selected: readonly string[];
  readonly firstToolCorrect: boolean;
  readonly orderCorrect: boolean;
  readonly missing: readonly AssistantToolName[];
  readonly forbidden: readonly string[];
  readonly unnecessary: readonly string[];
  readonly unknown: readonly string[];
  /** Only tool-selection behavior; not evidence that the task actually succeeded. */
  readonly toolPathPassed: boolean;
  /** null means no real final-state verification was provided. */
  readonly objectivePassed: boolean | null;
}

/** Pure offline grader for model/tool-call traces. Execution and permissions are untouched. */
export function scoreToolTrace(
  scenario: ToolSelectionScenario,
  selected: readonly string[],
  observedGoalReached: boolean | null = null,
): ToolTraceScore {
  const expected = [...scenario.expected];
  const firstAnyOf = scenario.firstAnyOf ?? (expected.length ? [expected[0]!] : []);
  const firstToolCorrect = expected.length === 0
    ? selected.length === 0
    : selected.length > 0 && firstAnyOf.includes(selected[0] as AssistantToolName);

  const order = selected.filter((name) => expected.includes(name as AssistantToolName));
  let cursor = 0;
  for (const name of order) {
    if (name === expected[cursor]) cursor += 1;
  }
  const orderCorrect = cursor === expected.length;
  const counts = new Map<string, number>();
  for (const name of selected) counts.set(name, (counts.get(name) ?? 0) + 1);
  const required = new Map<string, number>();
  for (const name of expected) required.set(name, (required.get(name) ?? 0) + 1);
  const missing = expected.filter((name) => {
    const remaining = counts.get(name) ?? 0;
    if (remaining === 0) return true;
    counts.set(name, remaining - 1);
    return false;
  });
  const forbidden = selected.filter((name) => (scenario.forbidden ?? []).includes(name as AssistantToolName));
  const unknown = selected.filter((name) => !toolIntelligence(name));
  const consumed = new Map<string, number>();
  const unnecessary = selected.filter((name) => {
    if ((scenario.optional ?? []).includes(name as AssistantToolName)) return false;
    const used = (consumed.get(name) ?? 0) + 1;
    consumed.set(name, used);
    return used > (required.get(name) ?? 0);
  });
  const toolPathPassed = firstToolCorrect && orderCorrect
    && missing.length === 0 && forbidden.length === 0
    && unnecessary.length === 0 && unknown.length === 0;
  return {
    scenarioId: scenario.id,
    selected: [...selected],
    firstToolCorrect,
    orderCorrect,
    missing,
    forbidden,
    unnecessary,
    unknown,
    toolPathPassed,
    objectivePassed: observedGoalReached === null ? null : toolPathPassed && observedGoalReached,
  };
}
