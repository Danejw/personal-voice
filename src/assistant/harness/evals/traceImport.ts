import type { ToolEvalTrace } from "@/assistant/harness/evals/traceRecorder";
import { MAX_EVAL_TOOL_ATTEMPTS } from "@/assistant/harness/evals/traceRecorder";

const origins = new Set(["live", "fixture", "mock", "imported"]);
const modalities = new Set(["typed", "voice", "unknown"]);
const platforms = new Set(["windows", "android", "unknown"]);
const statuses = new Set(["observed", "acknowledged", "reference", "incomplete", "failed", "cancelled", "blocked", "pending"]);
const failures = new Set(["cancelled", "busy", "invalid_arguments", "stale_target", "offline", "unavailable", "transient", "unknown", null]);
const SAFE_ID = /^[a-z0-9][a-z0-9_-]{0,95}$/i;
const SAFE_TOOL = /^[a-z][a-z0-9_]{0,79}$/;
const ALLOWED_TRACE = ["version", "scenarioId", "origin", "modality", "platform", "attempts", "goal"] as const;
const ALLOWED_ATTEMPT = ["tool", "startMs", "durationMs", "status", "failureKind"] as const;

function record(item: unknown): Record<string, unknown> {
  if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("Expected an evaluation record.");
  return item as Record<string, unknown>;
}
function only(recordValue: Record<string, unknown>, allowed: readonly string[]): void {
  for (const key of Object.keys(recordValue)) {
    if (!allowed.includes(key)) throw new Error(`Unexpected field: ${key}. Traces may not include prompts, arguments or response text.`);
  }
}
function integerMs(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 3_600_000;
}

export function parseEvalTraces(input: unknown): ToolEvalTrace[] {
  if (!Array.isArray(input) || input.length > 256) throw new Error("Expected an array of up to 256 evaluation traces.");
  return input.map((raw) => {
    const t = record(raw);
    only(t, ALLOWED_TRACE);
    if (t.version !== 1 || typeof t.scenarioId !== "string" || !SAFE_ID.test(t.scenarioId)
      || !origins.has(t.origin) || !modalities.has(t.modality) || !platforms.has(t.platform))
      throw new Error("Invalid evaluation trace header.");
    if (!Array.isArray(t.attempts) || t.attempts.length > MAX_EVAL_TOOL_ATTEMPTS)
      throw new Error("Invalid tool attempt count.");
    const attempts = t.attempts.map((rawAttempt: unknown) => {
      const a = record(rawAttempt);
      only(a, ALLOWED_ATTEMPT);
      if (typeof a.tool !== "string" || !SAFE_TOOL.test(a.tool)
        || !integerMs(a.startMs)
        || (a.durationMs !== null && !integerMs(a.durationMs))
        || !statuses.has(a.status) || !failures.has(a.failureKind))
        throw new Error("Invalid tool attempt.");
      return {
        tool: a.tool,
        startMs: a.startMs,
        durationMs: a.durationMs,
        status: a.status,
        failureKind: a.failureKind,
      };
    });
    const goal = record(t.goal);
    only(goal, ["passed", "source"]);
    if (goal.passed !== null && typeof goal.passed !== "boolean")
      throw new Error("Invalid goal observation.");
    if (!["manual", "device", "mock", "unverified"].includes(String(goal.source)))
      throw new Error("Invalid goal evidence source.");
    if (goal.source === "unverified" && goal.passed !== null)
      throw new Error("Unverified goal cannot claim a boolean outcome.");
    if (goal.source !== "unverified" && goal.passed === null)
      throw new Error("Verified goal requires an independently observed boolean.");
    return {
      version: 1,
      scenarioId: t.scenarioId,
      origin: t.origin,
      modality: t.modality,
      platform: t.platform,
      attempts,
      goal,
    } as ToolEvalTrace;
  });
}
