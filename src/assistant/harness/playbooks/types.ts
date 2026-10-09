import type { AssistantToolName } from "@/assistant/harness/toolIntelligence";

/** A reference workflow, not an executor or a substitute for observed tool results. */
export interface ToolPlaybookStep {
  readonly goal: string;
  readonly tools: readonly AssistantToolName[];
  /** A step is conditional unless the currently observed context makes it necessary. */
  readonly when: string;
  readonly outcome: string;
}

export interface ToolPlaybook {
  readonly id: string;
  readonly title: string;
  readonly platform: "all" | "windows";
  /** User intent that justifies loading this playbook. */
  readonly useWhen: string;
  /** Cases where loading this playbook wastes time or uses the wrong approach. */
  readonly skipWhen: string;
  readonly steps: readonly ToolPlaybookStep[];
  readonly branches: readonly string[];
  readonly recovery: readonly string[];
  readonly completion: readonly string[];
}

/** Reuse the exact existing tool contracts; these steps never call tools themselves. */
export function playbookStep(
  goal: string, tools: readonly AssistantToolName[], when: string, outcome: string,
): ToolPlaybookStep {
  return { goal, tools, when, outcome };
}
