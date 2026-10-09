import type { ToolFailureKind, ToolOutcomeStatus } from "@/assistant/harness/toolResults";
import type { AssistantToolFamily } from "@/assistant/harness/toolIntelligence";

/** No prompts, arguments, outputs, account IDs, window titles or raw error text. */
export interface AssistantToolAttempt {
  id: string;
  deviceId: string;
  epoch: number;
  occurredAt: string;
  localDay: string;
  tool: string;
  family: AssistantToolFamily | "unknown";
  outcome: ToolOutcomeStatus;
  failureKind: ToolFailureKind;
  /** Elapsed time including any time waiting for user confirmation. */
  elapsedMs: number;
  /** No claim of task completion without independent, separately supplied evidence. */
  goalVerified: boolean | null;
}

export interface ToolMetric {
  key: string;
  calls: number;
  acknowledged: number;
  observed: number;
  incomplete: number;
  failed: number;
  blocked: number;
  cancelled: number;
  reference: number;
  medianMs: number;
  p95Ms: number;
}

export interface AssistantToolSummary {
  calls: number;
  acknowledged: number;
  observed: number;
  incomplete: number;
  failed: number;
  blocked: number;
  cancelled: number;
  reference: number;
  resolvedRate: number | null;
  medianMs: number | null;
  p95Ms: number | null;
  failures: { key: string; count: number }[];
  tools: ToolMetric[];
  categories: ToolMetric[];
  byDay: { day: string; calls: number; failed: number }[];
}

export function isToolOutcome(value: unknown): value is ToolOutcomeStatus {
  return typeof value === "string" && [
    "observed", "acknowledged", "reference", "incomplete",
    "failed", "cancelled", "blocked",
  ].includes(value);
}
export function isToolFailureKind(value: unknown): value is ToolFailureKind {
  return value === null || typeof value === "string" && [
    "cancelled", "busy", "invalid_arguments", "stale_target",
    "offline", "unavailable", "transient", "unknown",
  ].includes(value);
}

const quantile = (items: readonly number[], fraction: number): number => {
  if (!items.length) return 0;
  const sorted = [...items].sort((a,b) => a-b);
  return sorted[Math.min(sorted.length-1, Math.ceil(sorted.length*fraction)-1)] ?? 0;
};

function buildMetric(key: string, rows: readonly AssistantToolAttempt[]): ToolMetric {
  const durations = rows.map(r => r.elapsedMs);
  const count = (outcome: ToolOutcomeStatus) => rows.filter(r => r.outcome === outcome).length;
  return { key, calls: rows.length,
    acknowledged: count("acknowledged"), observed: count("observed"),
    incomplete: count("incomplete"), failed: count("failed"),
    blocked: count("blocked"), cancelled: count("cancelled"),
    reference: count("reference"), medianMs: quantile(durations,.5),
    p95Ms: quantile(durations,.95) };
}

/**
 * A tool response rate is not a task completion rate.
 * Exclude user cancellations and reference-only playbook loads from the denominator.
 */
export function summarizeToolReliability(rows: readonly AssistantToolAttempt[], fromDay: string, throughDay: string): AssistantToolSummary {
  const period = rows.filter(e => e.localDay >= fromDay && e.localDay <= throughDay);
  const total = buildMetric("all",period);
  const eligible = total.acknowledged + total.observed + total.failed + total.blocked + total.incomplete;
  const groups = (of: (r: AssistantToolAttempt) => string): ToolMetric[] => {
    const map = new Map<string, AssistantToolAttempt[]>();
    for (const e of period) map.set(of(e), [...(map.get(of(e)) ?? []), e]);
    return [...map].map(([key,entries]) => buildMetric(key,entries))
      .sort((a,b) => b.calls - a.calls || a.key.localeCompare(b.key));
  };
  const failMap = new Map<string,number>(), daily = new Map<string, {day:string;calls:number;failed:number}>();
  for(const e of period) {
    if (e.failureKind) failMap.set(e.failureKind, (failMap.get(e.failureKind) ?? 0)+1);
    const value = daily.get(e.localDay) ?? { day:e.localDay, calls:0, failed:0 };
    value.calls++;
    if (e.outcome === "failed" || e.outcome === "blocked") value.failed++;
    daily.set(e.localDay,value);
  }
  return {
    ...total, resolvedRate: eligible ? (total.acknowledged + total.observed) / eligible : null,
    medianMs: period.length ? total.medianMs : null,
    p95Ms: period.length ? total.p95Ms : null,
    tools: groups(e=>e.tool), categories: groups(e=>e.family),
    failures: [...failMap].map(([key,count])=>({key,count})).sort((a,b)=>b.count-a.count),
    byDay: [...daily.values()].sort((a,b)=>a.day.localeCompare(b.day)),
  };
}
