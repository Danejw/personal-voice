import type { ToolFailureKind, ToolOutcomeStatus, ToolResultAssessment } from "@/assistant/harness/toolResults";

export type EvalModality = "typed" | "voice" | "unknown";
export type EvalPlatform = "windows" | "android" | "unknown";
export type EvalOrigin = "live" | "fixture" | "mock" | "imported";

/** Sanitized trace: no function arguments, transcripts, screenshots, tokens or response text. */
export interface ToolEvalAttempt {
  readonly tool: string;
  /** Relative monotonic milliseconds since capture began. */
  readonly startMs: number;
  readonly durationMs: number | null;
  readonly status: ToolOutcomeStatus | "pending";
  readonly failureKind: ToolFailureKind;
}

export interface GoalObservation {
  /** Must be assessed outside the tool acknowledgement. */
  readonly passed: boolean | null;
  readonly source: "manual" | "device" | "mock" | "unverified";
}

export interface ToolEvalTrace {
  readonly version: 1;
  readonly scenarioId: string;
  readonly origin: EvalOrigin;
  readonly modality: EvalModality;
  readonly platform: EvalPlatform;
  readonly attempts: readonly ToolEvalAttempt[];
  /** Only an external observation may establish goal completion. */
  readonly goal: GoalObservation;
}

/** Enforce a tight ceiling; never record raw user/model or application content. */
export const MAX_EVAL_TOOL_ATTEMPTS = 64;

export interface TraceMetadata {
  readonly scenarioId: string;
  readonly modality: EvalModality;
  readonly platform: EvalPlatform;
  readonly origin?: EvalOrigin;
}

const SAFE_ID = /^[a-z0-9][a-z0-9_-]{0,95}$/i;
const SAFE_TOOL = /^[a-z][a-z0-9_]{0,79}$/;
const DEFAULT_GOAL: GoalObservation = { passed: null, source: "unverified" };

export class ToolTraceRecorder {
  private readonly started: number;
  private readonly attempts: ToolEvalAttempt[] = [];
  private readonly active = new Map<string, number>();

  constructor(
    private readonly metadata: TraceMetadata,
    private readonly now: () => number = () => performance.now(),
  ) {
    if (!SAFE_ID.test(metadata.scenarioId)) throw new Error("Invalid evaluation scenario ID.");
    this.started = now();
  }

  noteCalls(calls: readonly { id: string | null; name: string }[]): void {
    for (const call of calls) {
      if (!call.id || !SAFE_TOOL.test(call.name) || this.attempts.length >= MAX_EVAL_TOOL_ATTEMPTS) continue;
      const index = this.attempts.length;
      this.attempts.push({
        tool: call.name,
        startMs: Math.max(0, Math.round(this.now() - this.started)),
        durationMs: null,
        status: "pending",
        failureKind: null,
      });
      this.active.set(call.id, index);
    }
  }

  noteResult(id: string, assessment: ToolResultAssessment): void {
    const index = this.active.get(id);
    if (index === undefined) return;
    this.active.delete(id);
    const original = this.attempts[index];
    if (!original) return;
    this.attempts[index] = {
      ...original,
      durationMs: Math.max(0, Math.round(this.now() - this.started - original.startMs)),
      status: assessment.status,
      failureKind: assessment.failure_kind,
    };
  }

  snapshot(): ToolEvalTrace {
    return {
      version: 1,
      scenarioId: this.metadata.scenarioId,
      origin: this.metadata.origin ?? "live",
      modality: this.metadata.modality,
      platform: this.metadata.platform,
      attempts: this.attempts.map((attempt) => ({ ...attempt })),
      goal: { ...DEFAULT_GOAL },
    };
  }
}
