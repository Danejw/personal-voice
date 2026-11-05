import {
  parseInteraction,
  planComputerStep,
  type ComputerCall,
} from "@/assistant/computerActions";

export interface ComputerImage {
  jpeg: string;
  width: number;
  height: number;
}

export type ComputerTaskStatus = "verified" | "unverified" | "stopped" | "blocked";

export interface ComputerTaskReport {
  status: ComputerTaskStatus;
  steps: number;
  summary: string;
  /** Screenshot-derived verification evidence, not an action acknowledgement. */
  evidence: string | null;
}

export interface ComputerTaskHost {
  now(): number;
  stopped(): boolean;
  capture(): Promise<ComputerImage>;
  propose(body: Record<string, unknown>): Promise<unknown>;
  execute(call: ComputerCall, image: ComputerImage): Promise<string>;
  confirm(explanation: string): Promise<boolean>;
  /** Injectable for deterministic tests; only observation calls are retried. */
  sleep?(ms: number): Promise<void>;
  onProgress?(step: number, action: string): void;
  /** A fresh post-action screenshot is inspected independently of the action receipt. */
  verify?(goal: string, image: ComputerImage, modelSummary: string): Promise<string | null>;
}

export interface ComputerTaskLimits {
  maxSteps: number;
  maxDurationMs: number;
  allowRoutineDrag?: boolean;
}

export const REMOTE_COMPUTER_LIMITS: ComputerTaskLimits = {
  maxSteps: 240,
  maxDurationMs: 30 * 60 * 1000,
  allowRoutineDrag: true,
};

function retryableObservationError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error instanceof TypeError
    || /(?:network|fetch|timed? out|temporarily unavailable|rate-limited|could not reach|couldn't reach|service failed|HTTP 5[0-9][0-9])/i.test(error.message);
}

/** Retrying screen/model *reads* is safe; replaying a native action is not. */
async function readWithRetry<T>(
  read: () => Promise<T>,
  host: ComputerTaskHost,
  startedAt: number,
  maxDurationMs: number,
): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try { return await read(); }
    catch (error) {
      if (attempt >= 2 || !retryableObservationError(error) || host.stopped()) throw error;
      const pause = 250 * (attempt + 1);
      if (host.now() - startedAt + pause >= maxDurationMs) throw error;
      await (host.sleep ? host.sleep(pause) : new Promise<void>(resolve => setTimeout(resolve, pause)));
    }
  }
}

function report(status: ComputerTaskStatus, steps: number, summary: string, evidence: string | null = null): ComputerTaskReport {
  return { status, steps, summary, evidence };
}

/**
 * A goal is never complete merely because a model stops calling tools.
 * Completion requires a fresh screenshot and an explicit postcondition verifier.
 * A stopped/blocked run reports progress without claiming that nothing happened.
 */
export async function runComputerTaskReport(
  goal: string,
  host: ComputerTaskHost,
  limits: ComputerTaskLimits = { maxSteps: 8, maxDurationMs: 45_000 },
): Promise<ComputerTaskReport> {
  const startedAt = host.now();
  let previousId: string | null = null;
  let result: { name: string; callId: string; result: string; acknowledgement: boolean; imageBase64: string | null } | null = null;
  let executed = 0;
  for (let step = 0; step < limits.maxSteps; step += 1) {
    if (host.stopped()) return report("stopped", executed, `Stopped after ${executed} actions. The goal was not verified.`);
    if (host.now() - startedAt >= limits.maxDurationMs) {
      return report("blocked", executed, `Time limit reached after ${executed} actions. The goal was not verified.`);
    }
    const image = await readWithRetry(() => host.capture(), host, startedAt, limits.maxDurationMs);
    if (host.stopped()) return report("stopped", executed, `Stopped after ${executed} actions. The goal was not verified.`);
    const interaction = parseInteraction(await readWithRetry(() => host.propose({
      goal,
      image: previousId ? null : image.jpeg,
      previousInteractionId: previousId,
      functionResult: result
        ? { name: result.name, callId: result.callId, result: result.result, acknowledgement: result.acknowledgement, image: image.jpeg }
        : null,
    }), host, startedAt, limits.maxDurationMs));
    if (host.stopped()) return report("stopped", executed, `Stopped after ${executed} actions. The goal was not verified.`);
    if (!interaction.call) {
      const said = interaction.text.trim();
      if (!said) return report("unverified", executed, "Computer Use ended without an action or completion evidence.");
      if (!host.verify) return report("unverified", executed, `Model reported: ${said}`);
      try {
        const fresh = await readWithRetry(() => host.capture(), host, startedAt, limits.maxDurationMs);
        if (host.stopped()) return report("stopped", executed, `Stopped after ${executed} actions. The goal was not verified.`);
        const evidence = await readWithRetry(() => host.verify!(goal, fresh, said), host, startedAt, limits.maxDurationMs);
        if (host.stopped()) return report("stopped", executed, `Stopped after ${executed} actions. The goal was not verified.`);
        if (evidence && evidence.trim().length >= 12) {
          return report("verified", executed, said, evidence.trim().slice(0, 500));
        }
        return report("unverified", executed, `Model reported: ${said}. Fresh-screen verification did not confirm the goal.`);
      } catch {
        return report("unverified", executed, `Model reported: ${said}. Final screen verification was unavailable.`);
      }
    }
    if (!interaction.id || !interaction.callId) {
      return report("blocked", executed, "Computer Use returned an action without its interaction or call ID. No action was executed.");
    }
    const decision = planComputerStep(interaction.call, step, startedAt, host.now(), host.stopped(), limits);
    if (decision.action === "stop") return report("blocked", executed, decision.message);
    let acknowledgement = false;
    if (decision.action === "confirm") {
      const allowed = await host.confirm(decision.explanation);
      if (!allowed || host.stopped()) {
        return report("stopped", executed, `Stopped after ${executed} actions because confirmation was declined or the task was cancelled.`);
      }
      acknowledgement = true;
    }
    const outcome = await host.execute(decision.call, image);
    executed += 1;
    host.onProgress?.(executed, decision.call.name);
    if (host.stopped()) return report("stopped", executed, `Stopped after ${executed} actions. The goal was not verified.`);
    previousId = interaction.id;
    result = { name: decision.call.name, callId: interaction.callId, result: outcome, acknowledgement, imageBase64: null };
  }
  return report("blocked", executed, `Step limit reached after ${executed} actions. The goal was not verified.`);
}

/** Existing local Assistant tooling expects text; include the actual verification state. */
export async function runComputerTask(
  goal: string,
  host: ComputerTaskHost,
  limits?: ComputerTaskLimits,
): Promise<string> {
  const outcome = await runComputerTaskReport(goal, host, limits);
  return `${outcome.status.toUpperCase()}: ${outcome.summary}${outcome.evidence ? ` Evidence: ${outcome.evidence}` : ""}`;
}
